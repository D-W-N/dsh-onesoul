# 可行性测试记录（Companion Bundle）

被测环境：Windows，DSH **0.2.0-rc.2**，`DSH_HOME=E:\dsh-onesoul\.verify\home`，聚合包以本地 tgz 装入 `web` profile。
被测实例：`dsh --profile web --no-open --port <n>`（端口用 `--port 0` 最稳，见 T5）。

## T1 子插件 HTTP 可读性（决定仪表盘「原生内嵌」还是「iframe 兜底」）

同一实例、带 `?token=` 换来的 `dsh-auth-*` cookie 同源请求：

| 路由 | 无 cookie | 带 cookie | 结论 |
|---|---|---|---|
| `GET /api/bili-pond/status` | 404 | **200** `{"ok":true,"home":"…\\bili-duty","config":{"perDay":5,"peakValley":false,"autoRun":false,…}}` | 可原生读，且确认**默认只读/自动运行关闭** |
| `GET /api/qqbot-settings/read` | 401 | **200** `{"value":{},"source":"patch","writerProfile":"","writerAt":0,"nsConflict":null}` | 可原生读（未配置时 `value:{}`） |
| `POST /api/plugin-rpc/webds` | 401 | **400**（路由存在、需要正确 payload） | 路由存在，只收 POST；位置 `dist/index.js:517-518,722`。**注：该插件已于 2026-10-28 晚按用户要求移除**（`docs/VERIFICATION.md §7.4`），此行为历史实测 |
| `GET /dsh-memes-api?packId=all` | **200** | 200 `{"ok":true,"total":24,"packs":[{"id":"dafeiyu-001","name":"大肥鱼","count":24}]}` | 本来就免鉴权 |
| `GET /api/qqbot-settings`、`GET /api/bili-pond` | — | 404 | **不是前缀路由**，必须用具体子路径 |

⇒ 结论：QQ / B站 / 表情包的状态**可以在浏览器半用同源 fetch 读到**（cookie 天然携带），
不必用 iframe；Host 半保持「安装扫描 + anima 文件读取」即可，无需拿到 token。

## T2 anima 记忆裁决端到端 + 重启持久化

```
POST /anima/api/capture {"text":"feasibility: user prefers coding at night"} → 200 id=mem_mvquxh77_36411625 status=candidate
GET  /anima/api/pending                                                  → 200 total=1
POST /anima/api/decide  {"id":"mem_mvquxh77_36411625","decision":"approve"} → 200 status=approved
```
落盘：`{DSH_HOME}/anima/memory.json`（361 B，status=approved，reviewedAt 有值）。
**重启实例后**：`GET /anima/api/approved` → 200 `total=1`（同一条 id）、`/anima/api/pending` → 200 `total=0`、
`GET /companion/api/status` → 200 且 `branches[0]` = `{id:"memory",native:true,ready:true}`。
⇒ 裁决闸门（候选 → 人工裁决 → 才进提示）与持久化都成立。

## T3 浏览器半能不能真的渲染（无 bsk 时的替代验证）

`scripts/ssr-check.mjs`：用 `.probe/render` 里的真 react@18 + react-dom/server，
加载**真实** `packages/dsh-companion-dashboard/lib/client.js`，伪造 `window.__ModuleLoader__` / `document` / `ctx`：

```
{"ok":true,"tabId":"companion:control-center","tabTitle":"控制中心","order":5,
 "styleInjected":1,"controlCenterHtmlLen":1308,"missingTokens":[],
 "qqBranchRendered":true,"biliBranchRendered":true}
```
`missingTokens:[]` 覆盖 `cmp-panel / 记忆 / QQ / B站 / 表情包`；`apply(ctx)` 确实调用 `registerTab`。
⇒ 组件在 React 下可渲染、Tab 描述符符合 `dsh-better-sidebar` 0.26.x 的 `TabDescriptor`（`service.d.ts:146-272`）。

## T4 人格统一的架构可行性（QQ 与主会话同一个提示）

`@zaofan/dsh-qqbot/index.js:34` → `export const inject = ['agents', 'systemPrompt']`，
并在 `inbound.js:267` 走 `systemPrompt.section/context` 装配；`dsh-anima` 用同一服务注入 order 5 的人设段
（`@deepseek-ai/dsh-system-prompt/index.d.ts:239` `section(section: PromptSection): () => void`）。
⇒ QQ 消息与 DSH 主会话**共享同一份 systemPrompt 装配**，人格段一次注入两边生效。
待真机验收：需要用户配好 AppID/AppSecret 后发一条 QQ 私聊（属用户侧验收项）。

## T5 复现时踩到的环境约束

- 端口 `2458` 直接 `listen EACCES`（Windows 保留区间），`2456` 会 `EADDRINUSE`（kill 掉 pwsh 后台 job 后 node 子进程仍存活）⇒ **用 `--port 0` 并从日志里解析真实端口**。
- 本机 npm 默认 cache 在工作区外 → `npm pack/install` 报 EPERM，必须 `--cache E:\dsh-onesoul\.probe\npmcache`。
- `bsk` 浏览器工具在本机起不来（`daemon failed to become ready`）⇒ 目视验收改由 T3 的 SSR 检查 + 打包产物字符串核对替代。

## T6 仪表盘通道分支改为「同源直读实时状态」（T1 结论落地）

改动：`packages/dsh-companion-dashboard/lib/client.js` 新增 `LIVE_ROUTES` + `summarizeLive(id, body)` +
`ChannelBranch` 内的 `useEffect` 拉取；失败自动降级为原提示文案。Host 半未改。

验证（`node scripts/ssr-check.mjs`，喂**实测 payload 原样**）：

```json
{"ok":true,"liveOk":true,
 "liveQq":["配置项：尚无配置项","来源：patch"],
 "liveBili":["每日互动额度：5 次","自动运行：关","写操作：关闭（当前只读）","数据目录：E:\\dsh-onesoul\\.verify\\home\\bili-duty"],
 "liveMeme":["图库：1 个（共 24 张）","大肥鱼×24"]}
```

回归：`scripts/smoke.mjs` 8/8 通过；重装 tgz 后真机启动（`--port 0` → 5762）日志零告警，
`/companion/api/status` 200 len 1273、`/anima/api/status` 200 len 639、`/anima/api/approved` 200 len 283。
