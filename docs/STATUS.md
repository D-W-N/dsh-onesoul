# 阶段总结 · dsh-onesoul（Companion Bundle）

**2026-11-01 夜：对外发布形态已改为单包 `dsh-onesoul@0.1.2`** —— npm https://www.npmjs.com/package/dsh-onesoul 、GitHub https://github.com/D-W-N/dsh-onesoul （tag `v0.1.0`，SSH over 443 推送）。anima 与 dashboard 的 lib 内置在包内 `plugins/`，第三方 7 包仍是 dependencies；本机两个 profile 仍用本地 `dsh-companion-bundle` 形态运行，未切换到 npm 单包。发布流程与凭证见 `docs/PUBLISH.md` 顶部。

**2026-11-01 深夜：本机 desktop / web 两个 profile 已切到单包** —— 依赖里删掉 dsh-anima 与 dsh-companion-dashboard，改成 `dsh-onesoul: ^0.1.2`（bundles 里 7 个第三方 bundle 摘掉，行改由 onesoul 的 patch 唯一插入，id 一律抄各包 canonical：`better-sidebar` / `dsh-expression` / `bili-pond`）。node_modules 是直接铺进磁盘的（没跑 pnpm install），**要重启桌面应用才生效**；回滚备份在 `E:/dsh-onesoul/.verify/backup-switch/{desktop,web}/`。详见 VERIFICATION §7.39。


截至 2026-11-01 晚。**代码与装配已完成并装进用户真实环境；QQ 真人号通道已实测能回话；仅剩 npm 发布与 B站扫码两项。**

2026-11-01 补记：QQ 链路当天整段失真（NapCat 登录成功但 OneBot 从不拨号），已定因并修通 —— 根因是 QQ 自动热更新到 `9.9.37-54395`、超出 NapCat 4.18.42 签名表（止于 `9.9.37-54276`），叠加「受限令牌拉起 QQ」与「QQNT 沙箱断点」两个环境问题。现在跑的是 `9.9.36-53644` + boot 模式 + `--no-sandbox`，验收见 `docs/VERIFICATION.md §7.31`。

## 一、已经成立的部分（有证据）

| # | 验收项 | 状态 | 证据指向 |
|---|---|---|---|
| 1 | 人格统一 | ✅ 机制成立 | anima 用 `systemPrompt.section`（order 5）注入，与通道无关；`anima_status` 在真实会话返回「阿音」人设（`docs/VERIFICATION.md §6`） |
| 2 | 记忆可控 | ✅ | 候选不入提示词、裁决后才注入；`/anima/api/decide` 二次裁决被拒；smoke 第 2/3/5 项 |
| 3 | 仪表盘 | ✅ 目视确认 | 用户确认 desktop 侧边栏出现「控制中心」，四个分支可见；宿主日志 `[dsh-companion-dashboard] 已挂载: GET /companion/api/status` |
| 4 | 一行装齐 | ✅ 本地形态 | `.verify/app` 一次 `npm install` 装齐 9 个包；`dsh --profile web --dump-config` 9 行齐全；**npm 形态待发布** |
| 5 | 故障隔离 | ✅ | better-sidebar 曾被自动禁用、qqbot 缺包时，其他行照常运行（`docs/VERIFICATION.md §4.1`、`§7.6`） |
| 6 | 网页大脑 | ✅ 实测 | 大脑层是 `dsh-deepseek-web-login@1.0.3`（原生 provider 路由 `deepseek-web`），已设为**部署默认**（`agent-default-model` = `deepseek-web` / `deepseek-reasoner`）；`web-login/usage` 记 `ok:true`（`docs/VERIFICATION.md §7.7`） |
| 7 | QQ 通道（真人号） | ✅ 实测回话 | NapCat 扫码登录小号 3660096629、主号 2634024517 进 `adminUsers`；日志 `[dsh-onebot] OneBot connected` → `agent created for private:2634024517` → **`turn/end for private:2634024517: completed`**（`docs/VERIFICATION.md §7.7`） |
| 8 | B站通道（只读） | ✅ 实测 | 凭证 10-28 扫码仍有效（nav `isLogin:true` / `bili_25723317486`）；`bili_status` loggedIn true、`bili_search` 10 条、`bili_subtitle` 654 段中文、`bili_comments` 13 条；写操作 `likeOn/favOn/autoRun/autoComment` 全 false（`docs/VERIFICATION.md §7.8`） |
| 9 | QQ 自启动（NapCat boot） | ✅ 修通 | 协议适配器 2 个、8643 ESTABLISHED、`[dsh-onebot] OneBot connected`、trace 四行全绿（`§7.31`）；`start-napcat.bat` 已换成 boot 配方，旧 Node 模式留 `.bak-nodemode` |

剩 B站一项仍是「账号授权只能本人做」的环节（面板内扫码），不是装配缺陷。

## 二、装了哪些东西

两个 profile（`web` 与日常在用的 `desktop`）都已装齐同一套包：

```
dsh-anima@0.1.10              自建，灵魂层（人格 + 记忆裁决 + 可撤销/隔离区/哈希链账本 + 通道小抄；表情包 absPath 可直接发）
dsh-companion-dashboard@0.1.35 自建，控制中心 Tab + /companion/api/{status,model,combos,duty,duty/default,napcat/qr,interact,interact/send,media-roots,pond-gate}（选模型并下发到每个 QQ 聊天 / 免费链路 / NapCat 登录拉起 / 主人号朋友号 / 定时互动（间隔 + 时段 + 按星期排班）/ 媒体围栏放行表情包库 / `[表情: 描述]` 在 QQ 通道自动配图 / 鱼塘自动运行按星期停放与归还）
dsh-better-sidebar@0.26.1    侧边栏宿主（钉版本：0.28.x 要 dsh ≥0.2.1-rc.1）
dsh-deepseek-web-login@1.0.3 网页大脑（provider 路由 deepseek-web）
dsh-onebot-qq@0.9.6          QQ 通道（OneBot11，反向 WS 127.0.0.1:8643）
dsh-napcat-keeper@2.8.2      NapCat 看门狗 + 登录态（/dsh-napcat-keeper/state）
dsh-bili-pond@1.3.13         B站通道（只读优先、点赞收藏默认关）
dsh-meme@0.1.65              表情包
dsh-our-free-model@2.1.0     免费模型车道 + 命名降级链 combo（dashboard 的「免费链路」卡片读写它）
```

聚合包 `dsh-companion-bundle@0.1.41` 只做装配：`dependencies` + `cordis.patch.yml`（一个 insert 块 10 行 + 末尾三条顶层同 id 覆写行：`dsh-onebot` / `napcat-keeper` 的 `accessToken`、`agent-default-model` 的默认模型）+ `lib/index.js` 只有 `export {}`。

## 三、仓库结构与常用命令

```
packages/dsh-anima/                 人格 + 长期记忆（工具 8 个，路由 /anima/api/*）
packages/dsh-companion-dashboard/   /companion/api/status + betterSidebar Tab
packages/dsh-companion-bundle/      聚合包
scripts/smoke.mjs                   29 项冒烟（假 ctx，进程内 node:test）
scripts/ssr-check.mjs               浏览器半 SSR + 实时状态归一化
.verify/check-patch.mjs             聚合包 patch 结构与入口校验（含子路径导出与覆写行）
docs/{VERIFICATION,FEASIBILITY,QQ-SURVEY,PUBLISH,STATUS}.md
```

```bash
node --import ./scripts/shims/resolver.mjs scripts/smoke.mjs   # 29/29
node scripts/ssr-check.mjs                                      # ok + liveOk
node .verify/check-patch.mjs                                    # missingPackages/Entries = []、danglingOverrides = []
```

## 四、未做：npm 发布（唯一剩余项）

`npm whoami` → `ENEEDAUTH`。发布顺序与验证命令见 `docs/PUBLISH.md`：

```bash
cd packages/dsh-anima               && npm publish --access public   # 0.1.10
cd ../dsh-companion-dashboard       && npm publish --access public   # 0.1.35
cd ../dsh-companion-bundle          && npm publish --access public   # 0.1.41
# 之后：dsh plugin add --profile web dsh-companion-bundle
```

发布前已实测：用未发布的聚合包 tgz 安装会停在
`[ERR_PNPM_FETCH_404] GET …/dsh-companion-dashboard` ⇒ **聚合包一行装齐这件事只差发布**。

## 五、已知限制（不会再变的部分）

1. `dsh-better-sidebar` 与 DSH 版本强相关，本包钉 `^0.26.1`。
2. desktop profile 由 Electron 独占管理，`dsh plugin add --profile desktop` 被拒；桌面用户走 pnpm 手工装配（`docs/VERIFICATION.md §7.2`），这是本机日常 profile 的永久约束。
3. 桌面应用所有 HTTP 一律 403（连不存在路径也 403），desktop 侧只能目视验收，无法脚本自证。
4. DSH 只把 error 级 renderer console 写进日志，客户端侧 `console.log`/`console.warn` 不进日志。
5. 网页模型无原生 function calling ⇒ 只做生成/判断，执行始终由 DSH Agent Loop 负责。
6. `dsh-onebot` 的 `accessToken` 必须非空且与 `napcat-keeper` 一致（`lib/connection.js:250` 硬性要求），聚合包已给默认值，用户可自行改。
7. 渲染层偶发 `web boot: N entries did not activate` → 自恢复重载 → 仍失败则宿主退出并自启（非插件 `apply` 抛错），复盘见 `docs/VERIFICATION.md §7.6`。
8. 网页端账号有被风控的历史 ⇒ 网页大脑按「链式投喂 + 节流」运行（`C:\Users\1\.dsh\web-login\context-feed.json` = `chained`，`gate.json` 间隔 3000–6000ms / 30 分钟最多 12 次请求 / 窗口 256K），复盘见 `docs/VERIFICATION.md §7.12`。链式省的是**输入体积**，不减请求条数；被风控的号不要继续用，轮换会把负载摊到其他号上，但每 2 小时换号会打断投喂链（一次全量重发）。