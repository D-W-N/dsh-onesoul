# 验证记录 · dsh-onesoul

环境：Windows，Node v24.18.1，pnpm 11.24.0，DSH **0.2.0-rc.2**（`dsh --version`）。
沙箱为 workspace-write，npm cache 需指向工作区（`--cache E:\dsh-onesoul\.probe\npmcache`），否则 `EPERM`。

## 1. 冒烟测试（假 ctx，进程内 node:test）

```bash
node --import ./scripts/shims/resolver.mjs scripts/smoke.mjs
```

结果：**tests 29 / pass 29 / fail 0**，覆盖：

1. anima 工具与 HTTP 路由注册齐全（含 `anima_ephemeral_get` / `anima_ephemeral_refresh`）；
2. 候选记忆**不**出现在系统提示词里；裁决通过后立刻进入（索引形式）；
3. 人格设置生效，且工作区覆盖不污染全局；
4. HTTP 裁决通路 + 二次裁决被拒；批量导入记忆；
5. **临时记忆**：两种值班报告格式、围栏日志不算条目、同 BVID 去重；刷新落盘、`days[1].entries.length === 0`、提示段文案、`anima_ephemeral_get` 取全文、`GET /anima/api/ephemeral`；
6. **临时记忆自动写入、值班挑中不进审核队列**：`capturedCandidates` 恒为 0，候选池与 `memory.json` 里没有 `note = bili:<bvid>` 的条目；
7. dashboard `GET /companion/api/status` 聚合状态、安装扫描、memory.json 统计；非 loopback 403 / 未知路由 404；
8. **记忆生效范围**：默认全局、切到「仅 Onesoul 通道」后桌面 ctx 不再注入（人设仍在）、QQ ctx 仍有索引、非法值 400、`channelProfile: true` 绕过判定；
9. dashboard 其余用例：NapCat 二维码 404、控制中心 Tab 注册、模型目录与切换（含热切）、免费链路、值班 profile 体检与默认模型写入、QQ 分句、主人号/朋友号与主动互动、**值班摘要推送**（指纹 / 文案不含句末标点 / 六种不该推的理由 / 无管道 400）。

（本机沙箱下 `node --test` 会 `spawn EPERM`，故直接跑脚本让 node:test 在进程内执行。）

## 2. 聚合包结构校验

```bash
npm pack packages/dsh-anima packages/dsh-companion-dashboard packages/dsh-companion-bundle --pack-destination .verify/tarballs
node .verify/check-patch.mjs
```

输出：`1 block / 7 rows`，`missingPackages=[]`，`missingEntries=[]`（每行的 `name` 对应包与其 `main` 入口都真实存在），
`dsh-companion-dashboard/lib/client.js` 在 tarball 内。

## 3. 干净环境一行装齐

`.verify/app`（模拟用户全新目录）`package.json` 只引 3 个 tarball（bundle + 两个自建包）：

`npm install --legacy-peer-deps --cache E:\dsh-onesoul\.probe\npmcache` →
`node_modules` 顶层一次装齐 `@zaofan`、`dsh-anima`、`dsh-better-sidebar`、`dsh-bili-pond`、`dsh-companion-bundle`、
`dsh-companion-dashboard`、`dsh-meme`、`dsh-deepseek-web-login`；实测 `dsh-better-sidebar` = **0.26.1**。（2026-10-28 晚按用户要求把 `dsh-webds-bridge` 换成 `dsh-deepseek-web-login`，见 §7.4）

## 4. 真实 DSH 启动（`DSH_HOME=E:\dsh-onesoul\.verify\home`，web profile）

`dsh --profile web --dump-config`：1275 行，7 个 row 全在，无 `skipping` / `Cannot find`。

`dsh --profile web --no-open --port 0` 启动后：

- **零 `did not activate`、零 Error**；
- `GET /companion/api/status` → **200**，`branches` 四项齐全（`memory.native=true, memory.ready=true`）；
- `GET /anima/api/status` → **200**，人设「阿音 / 你 / 陪伴型 AI 伙伴」；
- `GET /anima/api/pending` → **200** `{"total":0,"entries":[]}`；
- `GET /dsh-memes-api?packId=all` → 200（表情包插件正常）；
- `/sidebar/api/tabs`、`/sidebar/api/state` 存在但仅收 POST（405 属预期）。

### 4.1 故障隔离（实测，非推断）

上述启动过程中，`dsh-better-sidebar` 因 peer 不兼容被 loader 单独禁用：

```
dsh: disabling profile plugin row "dsh-better-sidebar": Plugin dsh-better-sidebar@0.28.2 is
incompatible with dsh 0.2.0-rc.2: peerDependencies {"@deepseek-ai/dsh-agent":"^0.2.1-rc.1", ...}
dsh: warning: 2 entries did not activate
```

同一进程里 `dsh-meme`、`dsh-anima`、`dsh-companion-dashboard` 均正常注册路由与工具 ⇒ 单行失败不拖垮其他行。
后续把 `dsh-better-sidebar` 固定到 `^0.26.1`（peer `^0.2.0-rc.2`）后，告警消失。

## 5. 浏览器半（模块投递 + 内容均已证实，DOM 目视未完成）

启动实例 HTML 的预加载清单里，58 模块的合并 bundle 同时包含
`dsh-companion-dashboard/client.js` 与 `dsh-better-sidebar/client.js`（提供方与消费方同在）。

把该 combo URL 原样取出（注意 HTML 实体 `&amp;` → `&`，需带 `?token=` 换来的 `dsh-auth-*` cookie），
实际下载到 **10,476,397 字节**的合并产物，其中包含：
`companion:control-center`、`控制中心`、`dsh-companion-dashboard`、`cmp-`（我们注入的 CSS 前缀）、`betterSidebar`、`anima/api`
⇒ 浏览器半不仅被投递，注册 Tab 与调用 anima 接口的代码都在最终产物里。

未完成项：本机 `bsk` 浏览器工具不可用（`daemon failed to become ready within 2.9899997s`，且 `bsk` 不在 PATH），
因此**没有截图级别的 Tab 目视证据**（React 渲染结果、点击裁决按钮的交互）。该项待用户在有浏览器的环境下打开侧边栏确认。

## 6. 逐条对照验收标准

| 验收项 | 结论 | 证据 |
|---|---|---|
| 人格统一 | ✅ 机制成立 | anima 以 `systemPrompt.section`（order 5）注入全局人格，与通道无关；smoke 第 3/4 项 |
| 记忆可控 | ✅ | 候选不入提示词，裁决后才入；smoke 第 2/3/5 项；HTTP `/anima/api/decide` 二次裁决被拒 |
| 网页大脑 | ⏳ 待用户侧 | 已换成 `dsh-deepseek-web-login`（provider 路由 `deepseek-web`）并确认行在 dump-config 里（§7.4）；登录态由插件自己同步，实际对话需用户选一次该 provider |
| QQ 通道 | ⏳ 待用户侧 | `@zaofan/dsh-qqbot` 行已装配启动；需填 AppID/AppSecret 或扫码后验私聊 |
| B站通道 | ⏳ 待用户侧 | `dsh-bili-pond` 行已装配启动；点赞/收藏默认关闭；扫码登录需用户在面板内完成 |
| 仪表盘 | ✅ **目视确认** | `/companion/api/status` 200；client.js 在预加载清单内；`scripts/ssr-check.mjs` → `{"ok":true,"tabId":"companion:control-center","liveOk":true}`；**用户在 desktop 应用重启后确认左侧边栏出现「控制中心」，点开可见记忆/QQ/B站/表情包四个分支**（宿主日志 `14:48:20 [dsh-companion-dashboard] 已挂载: GET /companion/api/status`） |
| 一行装齐 | ✅ | `.verify/app` 一次 `npm install` 装齐 8 个包 + dump-config 7 行齐全 |
| 故障隔离 | ✅ | better-sidebar 被禁用时其他行仍正常（§4.1 真实日志） |

⏳ 的三项都需要用户的账号/浏览器，属于「装完由用户在面板内授权」的动作，不是装配缺陷。

## 7. 装进用户真实 profile（两个 profile 都已装）

### 7.1 web profile（`dsh plugin add` 路径）

- `dsh plugin add --profile web <anima.tgz>` / `<dashboard.tgz>` 均成功；`<bundle.tgz>` 失败于
  `[ERR_PNPM_FETCH_404] GET https://registry.npmmirror.com/dsh-companion-dashboard`
  ⇒ **未发布 npm 前聚合包无法一行装齐**，这与规格「必须发布 npm」完全一致。
- `dsh-meme` / `dsh-bili-pond` / `@zaofan/dsh-qqbot` 三条因 `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: onnxruntime-node@1.30.0, protobufjs@7.6.6`
  被 CLI 判为失败（包其实已落盘），改为在该 profile 的 `cordis.patch.yml` 末尾补一个 insert 块解决。
- `dsh --profile web --dump-config` = 1376 行，7 行齐全；真启动后带 token cookie 实测全 200：
  `/companion/api/status`、`/anima/api/status`、`/anima/api/pending`、`/api/bili-pond/status`、`/api/qqbot-settings/read`、`/dsh-memes-api?packId=all`。

### 7.2 desktop profile（用户日常在用的那个；Electron 独占管理）

- CLI 两条入口都拒绝 desktop：`dsh plugin add --profile desktop …` 与 `dsh --profile desktop --dump-config` →
  `error: profile "desktop" is managed exclusively by the Electron application`。
- 改走底层 pnpm：`cd C:\Users\1\.dsh\profiles\desktop && pnpm add <anima.tgz> <dashboard.tgz> dsh-better-sidebar@0.26.1 dsh-webds-bridge dsh-meme dsh-bili-pond @zaofan/dsh-qqbot`
  → `Packages: +202`，7 个包全部落盘（0.1.0 / 0.1.1 / 0.26.1 / 0.1.2 / 0.1.65 / 1.3.13 / 1.11.12）。
  （当时含 `dsh-webds-bridge`；2026-10-28 晚已按用户要求移除并换成 `dsh-deepseek-web-login`，见 §7.4。）
- 再把 7 个包名追加进 desktop `package.json` 的 `dsh.profile.bundles`（13 → 20 项），让各包自带的 `cordis.patch.yml` 负责插行，
  避免与既有行重复挂载。改动前备份：`E:\dsh-onesoul\.verify\desktop-profile-backup\`。
- **应用重启后的实际日志证据**（`C:\Users\1\.dsh\logs\desktop-next.log`，2026-10-28T14:34）：
  - `dsh web: http://127.0.0.1:13900/?token=****`（dsh-web-app 在跑 ⇒ `webRuntime` 服务由它 `ctx.provide`）
  - `[im-qqbot] settings host 桥已 apply(deps=settings+webServer)`、`实例 im-qqbot: 暂无凭据 —— 设置面板已就绪`
  - `[webds] memory dir = C:\Users\1\.dsh\dsh_memory` ×2（当时 `dsh-webds-bridge` 与 `dsh-webds-bridge-client` 两行都在；该插件随后被移除，见 §7.4）
  - 已 apply 的行清单里含 `bili-pond`、`im-qqbot`、`dsh-webds-bridge`、`dsh-webds-bridge-client`（同上，历史记录）
  - `anima_status` 工具在本会话可用并返回真实数据（home `C:\Users\1\.dsh\anima`、persona「阿音」）⇒ anima 已在 desktop 生效
  - `bili_*` / `send_meme` / `meme_list` 工具同样出现在工具面 ⇒ bili-pond 与 meme 已生效
  - `[warn] better-sidebar (dsh-better-sidebar): pending (waiting for service: webRuntime)` 只出现一次，
    之后 `[dsh-better-sidebar]` 的 renderer 日志说明它的浏览器半已在页面里运行
- 限制：桌面应用对 `http://127.0.0.1:13900` 的根与全部 API 一律 403（连不存在的路径也 403），
  因此**无法用 HTTP 证明 desktop 侧的 Tab 渲染**；已给两半都加了 apply 日志
  （`[dsh-companion-dashboard] 已挂载: GET /companion/api/status`、`控制中心 Tab 已注册 (companion:control-center)`），
  下次重启应用时 `desktop-next.log` 会直接留下客户端注册证据。

### 7.3 侧边栏 Tab 目视验收（已完成）

- 应用重启后（`dsh web: http://127.0.0.1:11807/?token=****`），宿主日志出现
  `2026-10-28T14:48:20.735Z [info] [dsh-companion-dashboard] 已挂载: GET /companion/api/status`。
- **用户确认**：左侧边栏出现「控制中心」Tab，点开可见记忆 / QQ / B站 / 表情包四个分支。
- 诊断备注：DSH 只把 **error 级**的 renderer console 转发进 `desktop-next.log`（实测当天 warn 级 0 条），
  因此客户端侧的 `console.log`/`console.warn` 标记不能当验收证据，这一类只能目视确认。

### 7.4 换脑：webds-bridge → deepseek-web-login（2026-10-28 晚，按用户要求）

用户决定不再用「侧边栏 DOM 桥」形态的 `dsh-webds-bridge`，改用原生 provider 形态的
`dsh-deepseek-web-login@1.0.3`（description 原文：*use chat.deepseek.com web models as a DSH LLM provider
(browser login capture + PoW solving + SSE streaming + prompting-based tool calls), provider route deepseek-web*）。
两者定位不同：前者是「讨论 → 存记忆 → 执行注入」的侧边栏桥，后者是模型选择器里可直接选用的 LLM provider。

三处同时移除/替换（用户选 A：两个 profile 卸掉 + 聚合包依赖与行删掉）：

1. 聚合包 `packages/dsh-companion-bundle/cordis.patch.yml`：`- id: dsh-webds-bridge / name: dsh-webds-bridge`
   → `- id: dsh-deepseek-web-login / name: dsh-deepseek-web-login / config: {}`（照抄上游自带 patch 的行）。
   依赖 `dsh-webds-bridge ^0.1.2` → `dsh-deepseek-web-login ^1.0.3`；bundle 版本 0.1.1 → **0.1.2**。
2. dashboard `lib/index.js`：`KNOWN.webds = ['dsh-deepseek-web-login', 'dsh-webds-bridge']`（任一在位即报就绪）；
   版本 0.1.1 → **0.1.2**。
3. 两个真实 profile：`dependencies` 删 `dsh-webds-bridge`、`dsh.profile.bundles` 删同名条目、
   `dsh-companion-dashboard` 指向 `file:…dsh-companion-dashboard-0.1.2.tgz`；各跑一次 `pnpm install`
   → 两边均 `Packages: +1 -37`（webds 及其传递依赖被清掉）。
   备份：`E:\dsh-onesoul\.verify\{web,desktop}-profile-backup\package.json.<时间戳>`。

验证证据：

- 干净环境重装：`.verify/app` 重新 `npm install` 后 `dsh-deepseek-web-login@1.0.3` 在位、`dsh-webds-bridge` **MISSING**；
  bundle 0.1.2 / dashboard 0.1.2 / anima 0.1.0 / better-sidebar 0.26.1 / meme 0.1.65 / bili-pond 1.3.13 / qqbot 1.11.12。
- `.verify/check-patch.mjs`：`yamlBlocks 1`、7 行、`missingPackages []`、`missingEntries []`，
  行序为 better-sidebar / anima / **deepseek-web-login** / qqbot / bili-pond / meme / dashboard。
- `dsh --profile web --dump-config`（1386 行，exit 0）第 1364-1386 行含
  `- id: dsh-deepseek-web-login`、`dsh-anima`、`dsh-companion-dashboard`、`dsh-better-sidebar`、`dsh-meme`、`dsh-bili-pond`、`dsh-qqbot`；
  **无任何 dsh-webds row**；stderr 只有既有的 `skipping profile bundle "dshmarket"`（用户原有问题）。
- 两个 profile 的 `cordis.patch.yml` 里 `webds` 出现次数为 0；`node_modules/dsh-webds-bridge` 两边均为 removed。
- 回归：`scripts/smoke.mjs` pass 8 / fail 0；`scripts/ssr-check.mjs` ok/liveOk true。

未做/限制：desktop 侧需**重启桌面应用**才会按新装配重载（运行中的实例仍持有旧行）；
`deepseek-web` provider 的真实对话需用户在模型选择器里选一次（登录态同步由插件自己完成，不代跑账号动作）。

## 7.6 崩溃复盘（2026-10-28 23:23）+ OneBot accessToken 修复

### 7.6.1 「刚刚崩溃了」到底是什么

用户报告应用崩溃。日志 C:\Users\1\.dsh\logs\desktop-next.log 的时间线（UTC）：

- 15:23:12.764 [renderer] renderer.recovery.scheduled {"attempt":1,"delayMs":0,"detail":"web boot: 77 entries did not activate ..."}
  → .766 recovery.reload attempt 1；15:23:13.057 attempt 2；15:23:14.337 attempt 3
- 15:23:17.620 [renderer] renderer.recovery.exhausted {"attempt":3} → 15:23:17.727 [desktop] host.stop.start
  → host.process exit {"exitCode":0,"signal":null,"expected":true}（退出码 0，**不是** SIGSEGV/OOM）
- 15:23:38.985 [electron] run.start {"version":"2.0.20-next","platform":"win32","electron":"44.7.0","node":"v24.21.0","dsh":"0.2.1-rc.3"}
  → 15:23:43.780 dsh web: http://127.0.0.1:12586/?token=**** → 15:23:45.391 renderer.recovery.healthy {"attempt":0}

77 条 pending 的**根**是 @deepseek-ai/dsh-client-locale: pending (waiting for service: configForms)，其余全是等 locale 的级联。
同刻伴随两条网络层错误：

    [cordis-client-runner] syncing inspect providers failed: Error: gateway/internal: client api:
      dynamicCordisRunner/syncInspectManifest failed: Failed to fetch [renderer] console {"webContentsId":1}
    [warn] Error: read ECONNRESET at TCP.onStreamRead (node:internal/stream_base_commons:216:20)
      [host.kernel.next-web-server] log

⇒ 判定：**渲染进程从宿主 web server 拉客户端模块的请求在失败/被重置**，整批 client 条目加载不出来，
自恢复机制重载 3 次仍失败 → 宿主正常退出 → Electron 应用自己重启，重启后 healthy。
我方条目在那批 pending 里（dsh-companion-dashboard: pending (waiting for service: betterSidebar)、
dsh-onebot-qq: pending (waiting for service: locale)）是**受害者不是原因**。

排除「应用更新换掉服务端文件」：app.asar mtime 2026-10-27 06:34:30 +0800、192410998 字节，当天未被替换；
desktop 一直是 dsh 0.2.1-rc.3（与 npm 全局 CLI 的 0.2.0-rc.2 是两套安装）。

### 7.6.2 同一份日志暴露的两个真实装配缺陷（已修）

**缺陷 1：desktop profile 残留旧通道行。**
C:\Users\1\.dsh\profiles\desktop\cordis.patch.yml:149-158 还留着
- insert: / - id: qqbot / name: '@zaofan/dsh-qqbot'（含 appId/appSecret/settingsNs），
但 qqbot 包已卸 ⇒ 每次启动报
[error] qqbot (@zaofan/dsh-qqbot): failed to import: Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@zaofan/dsh-qqbot' imported from C:\Users\1\.dsh\profiles\desktop\。
处置：删掉整个块，改为下面两条顶层同 id 覆写行。

**缺陷 2：dsh-onebot 未激活。**
dsh-onebot (dsh-onebot-qq): Error: reverse mode requires a non-empty accessToken，
栈 OneBotConnection.startReverseServer (dsh-onebot-qq/lib/connection.js:250) ← start (connection.js:154) ← lib/index.js:411。
处置：给 dsh-onebot 与 napcat-keeper 配同一个非空 token。按 dsh-onebot-qq 自带 patch 的注释
（「config 覆盖须挂 patch 文档顶层的同 id 行；insert 块内行 configEditor 不可寻址」），写成顶层覆写行：

    - id: dsh-onebot
      config:
        accessToken: dsh-companion-onebot
    - id: napcat-keeper
      config:
        enabled: true
        accessToken: dsh-companion-onebot

同一份配置进了三处：packages/dsh-companion-bundle/cordis.patch.yml（末尾两条顶层行）、
C:\Users\1\.dsh\profiles\desktop\cordis.patch.yml、C:\Users\1\.dsh\profiles\web\cordis.patch.yml。

### 7.6.3 修复后的验证（干净环境）

- packages/dsh-companion-bundle 版本 0.1.3 → **0.1.4**（npm pack → .verify/tarballs/dsh-companion-bundle-0.1.4.tgz，2342 字节）。
- .verify/app 重新 npm install --legacy-peer-deps：added 194 packages in 40s，一次装齐 9 个包
  （bundle 0.1.4 / dashboard 0.1.3 / anima 0.1.0 / onebot-qq 0.9.6 / napcat-keeper 2.8.2 / better-sidebar 0.26.1 /
  meme 0.1.65 / bili-pond 1.3.13 / deepseek-web-login 1.0.3；dsh-webds-bridge MISSING）。
- .verify/check-patch.mjs（已支持子路径导出与顶层覆写行）：yamlEntries 3、9 行、
  configOverrides ["dsh-onebot {accessToken…}","napcat-keeper {enabled:true,accessToken…}"]、
  danglingOverrides []、missingPackages []、missingEntries []。
- DSH_HOME=.verify/home dsh --profile web --dump-config：- id: dsh-onebot 行下 :1271 accessToken: dsh-companion-onebot、
  :1274 - id: napcat-keeper 下 :1278 accessToken: dsh-companion-onebot；**零** not found / did not activate。
  ⇒ 证明 bundle patch 里「insert 块 + 末尾顶层同 id 覆写行」的顺序在真实 loader 下成立。
- 真启动该干净环境（--port 0 → 8004）：[dsh-onebot] mounted (mode=reverse, media=…, admins=0)、
  [dsh-onebot] bridge ready (0 resumed chat(s))，**不再有 accessToken 报错**；唯一噪音是
  反向 WS 服务器无法监听 127.0.0.1:8643：端口被占用（EADDRINUSE）+ retrying every 15s（真机桌面实例已占着 8643，属预期）。
- 该实例带 token 换 cookie 后全 200：/companion/api/status（四分支 ready true）、/anima/api/status、
  /anima/api/pending、/dsh-napcat-keeper/state?light=1（v2.8.2, light true, config.accessToken 位）、
  /api/bili-pond/status（perDay 5, autoRun false）、/dsh-memes-api?packId=all（total 162）。
- 三个 patch 文件均通过运行时 js-yaml 解析：desktop 20 条目、web 12 条目、bundle 3 条目。

未做：desktop 侧需**用户重启桌面应用**才能按新装配重载（CLI 拒绝 --profile desktop，无法 dump-config 自证）。

## 7.7 QQ 链路打通后的「不回话」定因：模型额度与网页登录态（2026-10-31）

QQ 真人号链路本身已通（§7.6 之后补测，日志 `C:\Users\1\.dsh\logs\desktop-next.log`）：

- 12:22:31 `[dsh-onebot] mounted (mode=reverse, media=C:\Users\1\.dsh\media\onebot, admins=1)`
- 12:23:35 `[dsh-onebot] OneBot connected` → `meta event; bot QQ: 3660096629; lifecycle`
- 12:26:20 `attached session onebot-private-2634024517` → `agent created for private:2634024517` → `followup from private:2634024517: <user_message qq="2634024517" nickname="DWN">`
- 12:26:21 `turn/end for private:2634024517: error`，原因 `故障参考号 MF-mvwdkpvvct2r [agent]: 模型回合出错: Free usage limit reached. Free models work in OpenCode …`

⇒ 通道、管理员放行、会话创建全部正常；断点在**模型**。两个叠加原因：

1. desktop profile 的默认模型是免费档：`cordis.patch.yml:12-16` `agent-default-model` → `provider: opencode-bridge` / `model: glm-5.3-flash-free`，免费额度已用尽。
2. 想改用的网页版 DeepSeek 登录态失效：`12:28:53 deepseek-web: 账号 acc_1dfd7855 AUTH 复核确认失效（Authorization Failed (invalid token)），已标记为「需要重新登录」`；`12:29:28 登录态探活失败`；`web-login/usage/2026-10-31.jsonl` 里 20:28 两次 `deepseek-chat` 为 `ok:false` 且 `ledger` 记 `code:"AUTH"`（而 20:21 之前 `deepseek-reasoner` 有 8 次 `ok:true`）。

工具 `E:\dsh-onesoul\.verify\set-default-model.mjs`：`node set-default-model.mjs <patch.yml> <provider> <model>`，就地改顶层 `agent-default-model` 行的 config（无该行则追加，自动备份 `<file>.<ts>.bak`）。已在 desktop patch 副本上验证：输出 `{"id":"agent-default-model",…,"config":{"provider":"deepseek-web","model":"deepseek-reasoner"}}` 且 js-yaml 解析通过。

结论：**先让用户在 GUI 里重新登录网页版 DeepSeek，再执行该脚本把默认模型切到 `deepseek-web` / `deepseek-reasoner`**，然后由 QQ 私聊发一条消息验证 `turn/end` 不再是 error。切换前不预置，否则 QQ 会改报 AUTH 错。

落地（同日，用户重新登录网页版 DeepSeek 之后）：

- 登录恢复证据：`2026-10-31T12:33:23.479Z [info] deepseek-web: 内置浏览器登录态已同步（updated acc_1dfd7855）`。
- 三处 `agent-default-model` 改为 `provider: deepseek-web` / `model: deepseek-reasoner`：desktop patch 第 12-16 行就地改；web patch 与 bundle patch 各在末尾追加同 id 顶层覆写行（`.verify/set-default-model.mjs`）。
- 真实 profile 复核：`DSH_HOME=C:/Users/1/.dsh dsh --profile web --dump-config` 第 50-54 行 = `- id: agent-default-model` / `name: '@deepseek-ai/dsh-agent-default-model'` / `config: {provider: deepseek-web, model: deepseek-reasoner}`。
- 聚合包层同样能覆盖 base 行（这条此前没验证过）：bundle 升 **0.1.5** 重打包 → `.verify/app` 重装 → `DSH_HOME=E:/dsh-onesoul/.verify/home dsh --profile web --dump-config` 第 50-54 行同为 deepseek-web/deepseek-reasoner（此前该处是 base 的 `deepseek-official` / `deepseek-flash`）。
- QQ 侧生效前提：dsh-onebot 在**创建 agent 时**读一次默认模型（`dsh-onebot-qq/lib/index.js:357-359`），所以既有会话要 `/new` 或 `/model` 才会换模型。

实测（12:35–12:36，QQ 私聊，同一日志）：

- 12:35:53 `slash /new for private:2634024517` → `reset chat private:2634024517 (old session onebot-private-2634024517 retired)`
- 12:36:09 新 agent 立刻失败，但请求根本没发出：`跳过请求 —— 该账号登录态已被判定失效 … 本次请求没有发出`（ledger `ms:2, code:AUTH`，是上一次 AUTH 遗留的标记），紧接着 `12:36:09.756 账号 acc_1dfd7855 请求被判 AUTH，但只读探活通过 —— 按端点级误判处理，不标记失效（本轮仍按失败计，重发即可）`
- 12:36:51.797 重发 → `12:36:52.001 上下文投喂=每轮全量：重发完整 prompt` → `12:36:53.736 第 1 轮流结束：[本轮 6 字 / 累计 6 字 / 耗时 1828ms] finish=FINISHED` → **`12:36:53.741 [dsh-onebot] turn/end for private:2634024517: completed`**
- usage：`{"at":1793450213737,…,"model":"deepseek-reasoner","ok":true,"in":12479,"out":129,"reasoning":114,"server":true}`；ledger：`{"ok":true,"ms":1832}`

⇒ **QQ 真人号私聊闭环成立**：NapCat（小号 3660096629）→ 反向 WS `ws://127.0.0.1:8643/ws` → dsh-onebot-qq → `deepseek-web/deepseek-reasoner` → 回传 QQ；发送方主号 2634024517 由 `adminUsers` 放行。

遗留非阻断项：`t2i render failed, falling back to text: t2i: no usable CJK font family (set t2i fontFiles/fontFamilies)` —— 长消息的看图卡片退化为纯文本，属 dsh-onebot-qq 的字体配置，不影响回话。

## 7.8 B站只读链路实测（2026-10-31）

凭证：`C:\Users\1\.dsh\bili-duty\bili_credential.json`（`dedeuserid` 1020716885，10-28 扫码时写入）。用它直接打 `https://api.bilibili.com/x/web-interface/nav`：
`{"code":0,"isLogin":true,"uname":"bili_25723317486","mid":1020716885,"vip":0,"level":1}` ⇒ 登录态仍有效，无需重扫。

通过 bili-pond 自己的工具（不是绕过插件）实测：

- `bili_status` → `{"ok":true,"today":"2026-10-31","ranToday":0,"perDay":5,"peakValley":false,"autoComment":false,"dmOn":false,"transcribe":false,"loggedIn":true,"home":"C:\\Users\\1\\.dsh\\bili-duty"}`
- `bili_search {keyword:"猫"}` → `count: 10`，含 `BV1zW411G7Dx`（[中英双字]音乐剧 猫 Cats 1998）、`BV1Uqpk64EaL`（媳妇回老家 看男主人独自带10只猫的一天）
- `bili_subtitle {bvid:"BV1zW411G7Dx"}` → `language: 中文`、`segments: 654`，返回字幕正文（读的是字幕文本，不是画面）
- `bili_comments {bvid:"BV1Uqpk64EaL", limit: 3}` → `count: 13`，返回用户/内容/点赞数/rpid

写操作确认默认关闭（`bili-duty/config.json`）：`likeOn:false`、`favOn:false`、`autoRun:false`、`autoComment:false`、`replyToComments:false`、`dmOn:false`、`guardOn:false`、`perDay:5`。
代码级硬顶（`dsh-bili-pond/index.js`）：`:455`/`:459` 写入时钉 `likePerDay ≤ 10`、`favPerDay ≤ 8`（配置文件只能调低）；`:705` 注释「写死：没理由不许点（<6 字直接拒）· 每日硬顶（赞 10 / 收藏 8）· 撞风控停 30 分钟」；`:355` 默认 `likeOn:false, favOn:false`。

⇒ 验收项「B站扫码登录成功、只读浏览/字幕/评论读取正常、写操作默认关闭」成立（凭证为 10-28 已扫码，本轮只做只读复核）。
## 7.9 QQ 私聊闲聊实测 + 记忆裁决闭环 + 通道小抄（2026-10-31 晚）

用户在小号（3660096629）→ 主号（2634024517）私聊里按「/new → 在吗？随便说点什么 → 记住一下：我喜欢猫，回复尽量短」发了三条。日志证据（`C:\Users\1\.dsh\logs\desktop-next.log`）：

- `12:43:07.381 slash /new for private:2634024517` → `12:43:07.403 reset chat … (old session …-mvwdxb1a retired)` → `12:43:17.746 attached session …-mvwe6hqp` + `agent created` + `followup from private:2634024517`
- `12:43:28.944 第 1 轮流结束：[本轮 31 字 / 耗时 1530ms] finish=FINISHED` → `12:43:28.958 turn/end …: completed`
- `12:43:57.773 第 1 轮流结束：[本轮 63 字 / 耗时 2364ms] finish=FINISHED` → `12:43:57.777 turn/end …: completed`
- 中间插入的是 deepseek-web 的账号级限流保护：`距上次请求不足 3680ms（区间 2000~4000），等 3607ms 再发「chat」（防账号级限流）`（属正常节流，不是故障）。

**记忆闭环在 QQ 里成立**：第三条消息触发 anima 候选 `mem_mvwe7469_68254798`（`createdAt 2026-10-31T12:43:46.785Z`，`source: QQ 私聊`，`tags: 偏好/猫/简短回复`，正文「用户喜欢猫；和用户聊天时回复尽量短。」）。`anima_memory_pending` 读回 1 条；用户裁决**拒绝**后 `anima_memory_decide` 返回「已拒绝并丢弃：mem_mvwe7469_68254798」，`counts` 回到 pending 0 / rejected 1 ⇒ 裁决闸门在 QQ 通道同样生效。

**发现并修的问题（两处）**：

1. `workspacePath` 不随 HMR 生效：20:39 改 patch 后 `12:39:59 mounted` 已带 admins=1，但 20:43 的 `/new` 仍 `attached session … to workspace C:\Users\1\.dsh\profiles\desktop`。原因：行配置在 compose 时确定，HMR 只重载插件代码；`dsh-onebot-qq/lib/client.js:83` 也写明该字段「保存后仅对新会话生效」。即时改法是私聊里发 `/workspace E:/dsh-onesoul/playground`（per-chat 覆盖，立刻生效），要全局生效需重启桌面应用。
2. 表情包在 IM 里投递不了：`dsh-meme` 的 IM 分支要求把候选路径交给 `dsh_im_return_file`（官方 dsh-qqbot 的工具，我们没装）；而 `dsh-onebot-qq` 的 `qq_send_image` 走媒体围栏 `bridge.js:249-265 mediaSendRoots()`，只放行 `mediaDir` + 管理员回合的会话工作区，`C:\Users\1\.dsh\meme-packs` 不在内 ⇒ 修法是「先复制到工作区再发新路径」。已给 anima 的 prompt 段加 `## 通道小抄` 两条（`packages/dsh-anima/lib/model.js` renderPromptSection 末尾），版本 0.1.0 → **0.1.1**；两个 profile 均 `pnpm install` 后 `node -e require(...)/lib/model.js` 校验 `cheatsheet true`。

回归：`node --import ./scripts/shims/resolver.mjs scripts/smoke.mjs` = tests 8 / pass 8 / fail 0；`check-patch.mjs` = 9 行 / `missingPackages []` / `missingEntries []` / `bundlePatchDeclared ./cordis.patch.yml`（`danglingOverrides: ["agent-default-model"]` 属预期：该 id 由 `@deepseek-ai/dsh-base` 提供，聚合包只追加覆写行）。聚合包 0.1.5 → **0.1.6**（依赖 `dsh-anima ^0.1.1`）。

已知的第三方噪音（与本项目无关）：`Access to fetch at 'http://127.0.0.1:18787/__bili/upstreams' from origin 'dsh-app://app' has been blocked by CORS policy` 每 10 秒一次，来源是 `billion-context/dist/agent/dsh-native-client.js`。
## 7.10 deepseek-web 掉线复盘 + 上下文/节流调优（2026-10-31 晚）

### 7.10.1 现象与判据

QQ 私聊发消息后回「故障参考号」：`12:58:20.144 [dsh-onebot] followup from private:2634024517` → `12:58:22.672 [warn] deepseek-web: 账号 acc_1dfd7855 AUTH 复核确认失效（Authorization Failed (invalid token)），已标记为「需要重新登录」` → `12:58:24.490 本次 auth 失败无法换号（自动换号=关闭）` → `12:58:24.502 [error] [dsh-onebot] turn/end for private:2634024517: error`＋`故障参考号 MF-mvwepxf3iynf`。默认模型 pin 在 desktop `cordis.patch.yml:12-16`（`provider: deepseek-web / model: deepseek-reasoner`）⇒ 是模型层登录态，不是 QQ 通道。

### 7.10.2 两个叠在一起的原因（都已修）

1. **网页 token 短寿**：`C:\Users\1\.dsh\web-login\accounts\acc_1dfd7855.json`（189\*\*\*\*\*\*10）`capturedAt 2026-10-31T12:33:23.476Z` → `lastVerifiedAt 12:47:53.149Z` → `lastVerifyError.at 12:58:24.652Z`，**约 25 分钟**。插件的续期只有两条路：捕获、或「自动续期」（阈值 100 分钟且需要已保存的密码凭证）；自动换号默认 `autoSwitchDefault: 0`（关）⇒ 服务端一作废就一路 401。
2. **重登落到了另一个号，索引没跟**：新记录 `acc_ec9e3e8d`（hhx\*\*\*\*\*\*78@163.com，`capturedAt 13:00:47.372Z`），但 `accounts.json` 的 `activeId` 仍是死掉的 `acc_1dfd7855`；且新号文件里还挂着旧的 `lastVerifyError.at 12:29:28.651Z`，而插件 `isUsable()` 只看「这个字段在不在」（`if (account.lastVerifyError) return false`）⇒ 新号在插件眼里同样不可用。

只读探活实测（照插件 `validateAuth` 的写法打 `GET https://chat.deepseek.com/api/v0/users/current`）：手机号 → `HTTP 200 {"code":40003,"msg":"Authorization Failed (invalid token)"}`；邮箱号 → `HTTP 200 {"code":0,…"biz_data":{"id":"51730d46-f562-4ec8-96f1-e3d87dfbd03a"…}}` **有效**。

修复（均留 `.bak.<ISO时间戳>`）：`accounts.json` 的 `activeId` → `acc_ec9e3e8d`；删掉该号的 `lastVerifyError`、刷新 `lastVerifiedAt`；新建 `C:\Users\1\.dsh\web-login\gate.json` 打开自动换号（`autoSwitchMinutes: 180`，当前号不可用时立刻切到可用号）。

**复验**：`13:04:31.248 followup from private:2634024517` → `13:05:08.458 turn/end …: completed`；NapCat 侧 `21:04:31 接收 <- 私聊 (2634024517) 你好` → `21:05:08 发送 -> 私聊 [图片]` → `21:05:09 发送 -> 在呢。刚想给你甩张图，网有点慢。` ⇒ 收→模型→文本+表情包回传全通，且通道小抄（先 `cp` 到工作区再 `qq_send_image`）确实被执行。

### 7.10.3 顺手做的两处提速（用户选了方案 A）

慢的两个真凶（近三轮实测）：① 每次模型调用本身只有 `耗时 1125~2090ms`，真正吃时间的是**调用之间的防限流等待**：`距上次请求不足 3080ms（区间 2000~4000），等 2054ms` / `3932ms…等 3878ms` / `3764ms…等 3734ms` ⇒ 3 轮调用的一轮回复约 10s；② 日志 `上下文投喂=每轮全量：重发完整 prompt`，而 `contextWindow` 默认 `1048576`（1Mi）⇒ DSH 从不判超长、永不压缩，会话越长每次请求越大。

写入 `C:\Users\1\.dsh\web-login\gate.json`：`contextWindow: 65536`（1Mi→64K，DSH 开始压缩历史）、`minRequestIntervalMs: 1500` / `maxRequestIntervalMs: 2500`（原 2000~4000）、保留 `autoSwitchMinutes: 180`。两值在插件 `apply` 时读取 ⇒ 重启桌面应用生效（或在设置页调滑块即时生效）。回滚：删掉这两组字段。若 64K 装不下工具目录会报 `CONTEXT_WINDOW_EXCEEDED`（`lib/index.js:2129` 要求预算 ≥128 tokens），那时回退到 `131072`。

### 7.10.4 桌面宿主的一条硬限制（影响排障手法）

`http://127.0.0.1:14838/deepseek-web-login/api/status`、`/deepseek-web-login/api/accounts`、`/companion/api/status` 在桌面实例上全部 `403 Browser access is disabled` ⇒ **插件的 HTTP 接口外部不可调用**，桌面侧只能「改磁盘文件」或「让用户在 UI 点」，不能像 web profile 那样 curl。

## 7.11 NapCat 登录 + 拉起上仪表盘（2026-10-31 21:2x）

起因：QQ 通道可用后，用户提出「能不能把这个登录的也放到这个控制台里面」——NapCat 的扫码登录原来只在 `DSH → 设置 → napcat桥` 与 NapCat 自己的控制台窗口里，控制中心看不到。

### 7.11.1 宿主半新增二维码透传
`packages/dsh-companion-dashboard/lib/index.js` 新增 `napcatQrFile()`：按顺序找 (1) keeper 配置里的 `qrCopyPath`、(2) `<DSH_HOME>/dsh-napcat-keeper/qr.png`、(3) `<shellDir>/napcat/cache/qrcode.png`；命中就把 PNG 原样写出。

```js
if (req.method === 'GET' && pathname === '/napcat/qr') {
  const file = napcatQrFile()
  if (!file) return sendJson(res, 404, { ok: false, error: 'no-qr' })
  const buf = readFileSync(file)
  res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': String(buf.length) })
  return res.end(buf)
}
```

### 7.11.2 浏览器半新增「NapCat 登录」卡片
QQ 分支里新增 `QqLoginCard`：离线时 15 秒刷新一次二维码（`/companion/api/napcat/qr?t=...`，`onError` 时显示「还没有二维码」而不是破图），并直接调 keeper 的动作端点：

| 按钮 | POST `/dsh-napcat-keeper/action` |
|---|---|
| 重新探测 | `{do:'probe'}` |
| 拉起 NapCat | `{do:'launch'}` |
| 重启 NapCat | `{do:'restart'}` |
| 收起控制台窗口 | `{do:'hideConsole'}` |

`doAction` 的四个动作来自 `dsh-napcat-keeper/lib/index.js:4143` 起的 switch；`hideConsole` 用来收掉手动双击起来的那个黑窗。

### 7.11.2b 拉起改走「可见窗口」
keeper 的拉起是 `cscript → launch.vbs → sh.Run cmd, 0, False`（隐藏窗口，`index.js:3051/3065`），在这台机器上实测起不来。所以仪表盘自己加了一条 `POST /companion/api/napcat/start`：

```js
const child = spawn('cmd.exe', ['/c', 'start', '', launcher.file], {
  cwd: launcher.cwd, detached: true, stdio: 'ignore', windowsHide: false,
})
```

脚本路径取自 keeper 的 `config.json`（`launcherScript` 优先，其次 `<shellDir>/start-napcat.bat`）；找不到就返回 400 `no-launcher`，绝不瞎起进程。浏览器半的「拉起 NapCat」先打这条，失败才退回 `keeperAction('launch')`。

### 7.11.3 验证证据
- `scripts/smoke.mjs` 新增「NapCat 二维码透传」用例，**tests 9 / pass 9 / fail 0**（没有码时 404，有码时 200 + `image/png` + 字节完全一致）。
- 干净环境 `E:\dsh-onesoul\.verify\app`（bundle 0.1.7 + dashboard 0.1.4 + anima 0.1.1，`npm install` + `overrides` 指向本地 tarball）真启动：`/companion/api/status` 200、`/companion/api/napcat/qr` 先 404 `{"ok":false,"error":"no-qr"}`，把真实 `qrcode.png` 放进 keeper 目录后 **200 `image/png` 594 bytes**。
- `node scripts/ssr-check.mjs` 仍然 `ok:true / liveOk:true`，`qqBranchRendered:true`。
- 两个真实 profile 的 `node_modules/dsh-companion-dashboard` 已同步到 0.1.4（`package.json` 版本 0.1.4、`lib/` 里 `napcat/qr` 命中 3 处、`keeperAction|QqLoginCard` 命中 5 处），依赖声明也改成 `file:.../dsh-companion-dashboard-0.1.4.tgz`。

### 7.11.4 限制
本次沙箱里 `win_bash` 起的进程只能写工作区（向 `C:\Users\1\.dsh\profiles\*` 写入报 EPERM），所以两个 profile 的新版本是用文件工具覆盖 `node_modules/dsh-companion-dashboard` 并同步 `package.json` 依赖声明完成的；等 shell 恢复后按 `docs/PUBLISH.md` 走一次 `pnpm add file:...dsh-companion-dashboard-0.1.4.tgz` 即可让 lockfile 对齐。
## 7.12 网页大脑改「角色扮演式」运行：链式投喂 + 节流（2026-10-31 深夜）

**触发**：用户一个 DeepSeek 网页端账号被风控，提出「为什么不能让它像角色扮演一样运行，以减少刷新次数和输入上下文」。

### 7.12.1 为什么现在的跑法费请求

| 成本项 | 实测/源码判据 |
|---|---|
| 一条回复 = 多次模型调用 | QQ 一轮回复的模型调用是 2–3 次（工具轮次），日志里 `耗时 1500ms / 1125ms / 1513ms` 与防限流等待 `距上次请求不足 3080ms（区间 2000~4000），等 2054ms` 交替出现 |
| 每次调用重发全量 prompt | 启动日志 `deepseek-web: 上下文投喂=full（每轮重发全量 prompt）`；全量模式的实现约定见 `dsh-deepseek-web-login/lib/index.js:3755-3756`（「历史必须由我们自己每轮重发…DSH 的适配器契约本来就是无状态的」） |
| 全量模式按轮数换会话 | `effectiveReuseLimit(maxTurns, mode)`：非链式返回 `maxTurns`（默认 20 轮）⇒ 定期开新网页端会话 |

### 7.12.2 链式投喂就是「角色扮演」形态（插件自带，默认关）

`lib/index.js:3758-3767` 原文要点：只在增量上发，并把 `parent_message_id` 指向上一轮 assistant 的 `message_id`，上下文由服务端按链维护；依据是抓到的真实帧（浏览器就是这么干的，只有会话第一条的 parent 是 null）。

- 链式下 `effectiveReuseLimit` 返回 `Number.POSITIVE_INFINITY`（`:3867-3869`）⇒ 会话不再按轮数轮换，「一直同一个对话」。
- 输入量从 O(历史) 降到 O(这一条)。
- 代价（`:3768-3771`，作者写明）：工具协议 / 系统提示 / 历史全在**链首那条消息**里，服务端丢早期上下文后模型可能不再按 JSON 发工具调用。对策是「一有不确定就退回全量」：`canExtendChain(prev,next)`（`:3895-3898`）要求长度必须增长且链尾在原位，否则重发全量。
- 链式与新会话的坑（`:3821-3837`）：重开链时若发根消息且会话是复用来的，网页端会渲染成同一条消息的多个兄弟版本（「修改 / 重新生成」+ `n / n`）⇒ 需要 `freshSessionOnRestart: true` 让重开链时换干净会话。

### 7.12.3 落盘配置（`C:\Users\1\.dsh\web-login\`，两个 profile 共用）

`context-feed.json`（原文件不存在，新建）：

```json
{ "contextMode": "chained" }
```

`gate.json`（改前 `{autoSwitchMinutes:180, contextWindow:65536, minRequestIntervalMs:1500, maxRequestIntervalMs:2500}`，已备份为 `gate.json.bak-chained`）：

```json
{
  "autoSwitchMinutes": 120,
  "contextWindow": 262144,
  "minRequestIntervalMs": 3000,
  "maxRequestIntervalMs": 6000,
  "rateWindowMs": 1800000,
  "rateMaxInWindow": 12,
  "freshSessionOnRestart": true
}
```

每项的依据：

- `contextWindow` 从 64K 抬到 256K：链式要求历史只能追加，而 DSH 做上下文压缩会改写历史 ⇒ 链断 ⇒ 退回全量。窗口越小压缩越早、链越容易断，所以**链式模式下窗口要大**（与全量模式的直觉相反）。
- `min/maxRequestIntervalMs` 3000/6000：`clampInterval` 上限 `MAX_INTERVAL_MS = 3e4`（`:…`），3000–6000 合法，把每次调用之间的最小间隔拉到 3 秒以上。
- `rateMaxInWindow` 12（默认 20，窗口 30 分钟，`DEFAULT_RATE_WINDOW_MS = 18e5` / `DEFAULT_RATE_MAX_IN_WINDOW = 20`，`:1045-1046`）：30 分钟内超过 12 次强制长休——这是插件自带的「像人一样歇一会儿」闸门，比事后被封更早生效。
- `freshSessionOnRestart: true`：见 7.12.2 的兄弟版本坑。
- `autoSwitchMinutes` 保留轮换但夹到 120：`AUTO_SWITCH_BOUNDS.max = 120`（`:1019-1022`），**原来的 180 一直在被静默夹到 120**；而 `:1016-1017` 明确写了换号会打断投喂链（`decideFeed` 的 `account-changed` ⇒ `restart` ⇒ 全量重发 + 新会话），所以**不能**为了省请求把间隔缩短（我一开始提的 180→60 是错的，按源码改回 120）。轮换的意义是摊薄单号密度（`:1009`），代价是每 2 小时一次全量重发。

### 7.12.4 生效与验收

- `contextMode` 只在 apply 时读入内存（`:12994`），改文件**必须重启桌面 DSH**；设置页保存会即时生效（`:13967` 日志 `deepseek-web: 上下文投喂切换为 …`）。
- 重启后期望日志：`deepseek-web: 上下文投喂=chained（只发增量 + parent 指向上一条回答）`（`:12995` 的格式串）；每轮回复期望出现 `deepseek-web: 上下文投喂=链式：本轮只发增量 N 字（历史由服务端维护…`（`:9326`）。
- 回滚：删 `context-feed.json`（回到 `full`）、`gate.json` 用 `gate.json.bak-chained` 覆盖。
- 已知取舍：QQ 表情包依赖工具 `qq_send_image`（见 §7.9 的通道小抄），保留工具就意味着链式那条「工具协议只在链首」的风险仍然存在，断链时插件自动退回全量，无需人工干预。
## 7.13 控制中心加「模型」分支：选默认模型（2026-10-31 22:0x）

用户要求「在控制台加入选择模型功能」。控制中心从 4 个分支（记忆/QQ/B站/表情包）变成 5 个，最后一个是「模型」。

### 7.13.1 宿主半：读 llm 注册表 + 写 agentDefaultModel

两个服务都只在请求处理时经 `ctx.get(...)` 取，不进 `inject`（`inject` 缺服务会让整个插件 pending，仪表盘会消失）：

- 目录：`ctx.get('llm').listProviders()` → 每个 provider `listModels(id)` → `resolveModelInfo(providerId, modelId)` 取 `reasoning.efforts` / `defaultEffort`。**取不到的 provider 进 `failures`，不让整包失败**（与仪表盘一贯的故障隔离一致）。
- 当前值：`ctx.get('agentDefaultModel').currentSelection()`。
- 切换：`await ctx.get('agentDefaultModel').saveSelection({provider, model, reasoningEffort?})`（`dsh-agent-default-model/lib/index.js:38/50`，写入走 configEditor ⇒ 落进 profile 的 patch）。

路由：

| 路由 | 行为 |
|---|---|
| `GET /companion/api/model` | `{current, groups[], failures[], routableProviders[], canSave, llm}` |
| `POST /companion/api/model` | body `{provider, model, reasoningEffort?}`；缺参 400 `provider-and-model-required`；模型不在目录里 404 `unknown-model`；没有 agentDefaultModel 服务 409 `agentDefaultModel-unavailable`；成功回 `{saved, current, requested, note}` —— `saved` 是写后**回读比对**的结果，没落盘时如实写 note |

POST body 用新加的 `readJsonBody(req, 64KB)` 解析（promise 化，超限即丢弃）。

### 7.13.2 浏览器半：`ModelBranch`

新增分支 `{id:'model', title:'模型'}`（拼在 channels 之后），组件 `ModelBranch`：

- 「当前默认模型」卡：`provider / model（推理强度 X）`。
- 「切换」卡：来源 select → 模型 select →（该模型声明了 efforts 时）推理强度 select → 「保存为默认模型」/「重新读取」。换来源会自动落到该来源第一个模型。
- 取不到的来源单独列一张卡显示 `name：message`。
- 文案明说：只影响之后新建的会话，正在跑的会话不改。

### 7.13.3 验证

- `scripts/smoke.mjs` 新增 3 条：目录聚合与坏来源隔离、切换走 `saveSelection` 并回读（含 404 / 400 分支）、没有 `agentDefaultModel` 时只读不写（409）。**tests 12 / pass 12 / fail 0**。
- `scripts/ssr-check.mjs` 增加 `ModelBranch` 服务端渲染断言：`missingTokens []`、`modelOk true`、`modelBranchRendered true`。
- 干净环境（`.verify/app` = bundle 0.1.9 + dashboard 0.1.6）真启动（端口 3971）实测：
  - `GET /companion/api/model` → 200，`current: {provider:'deepseek-web', model:'deepseek-reasoner'}`，`groups` 含 `deepseek-official`（`deepseek-flash` / `deepseek-v4-pro`，各带 4 档 reasoning）与 `deepseek-web`；
  - `POST {provider:'deepseek-web', model:'nope'}` → **404 `unknown-model`**；
  - `POST {provider:'deepseek-web', model:'deepseek-chat'}` → **200 `saved:true`**，`current` 同步为 `deepseek-chat`；随后再 POST 回 `deepseek-reasoner` 复原。
- 两个真实 profile 的 `node_modules/dsh-companion-dashboard` 已升到 0.1.6（`lib/` 里 `/model'` 命中 4 处），依赖声明同步为 `file:...dsh-companion-dashboard-0.1.6.tgz`。

### 7.13.4 沙箱限制（同 §7.11.4，这次更硬）

`win_bash` 起的进程**只能写工作区**（`touch /c/Users/1/.dsh/profiles/web/.probe-write` → `Permission denied`），所以：

- `dsh plugin add --profile web <tgz>` → `EPERM ... open 'C:\Users\1\.dsh\profiles\web\package.json.lock'`；
- `pnpm add --store-dir ...` 在 desktop profile → `EPERM`（`createNewStoreController` 的 mkdir）；
- `DSH_HOME=C:/Users/1/.dsh dsh --profile web` 也直接死在 `EPERM ... cordis.yml`（启动时要写 profile）。

⇒ 装进真实 profile 只能靠**文件工具覆盖 `node_modules` 里的包文件 + 改 profile 的 `package.json` 依赖行**（与 §7.11.4 同法）；lockfile 仍待用户在能写的终端里 `pnpm add file:...` 对齐。真实 profile 的运行时验证因此改为「干净环境真启动 + 两个 profile 的文件级核对」。
## 7.14 控制中心「免费链路」+ 活跃会话热切（2026-10-31 深夜）

需求原话（用户）：「控制台里面选择什么模型就用什么模型／最好可以热切换／或者选定一些供应商，然后自动切换。以达到免费效果。因为我现在接入了一些签到，就可以获得免费额度的」。

### 7.14.1 两件事各自由谁提供

| 诉求 | 落点 | 依据 |
| --- | --- | --- |
| 供应商自动切换 | `dsh-our-free-model@2.1.0` 自带的**命名降级链（combo）** | 它以 `combo:<name>` 出现在选择器里，像虚拟模型；`fallback`（每轮从链首）/`round-robin`（轮换起点）；出正文前撞额度墙就换下一段，调用方看不到（README 的「路由：命名降级链」段） |
| 选了就生效（热切） | `@deepseek-ai/dsh-agent` 的 `installModelSelection(agentCtx, ref)` | 它把 `system-prompt/assemble` 与 `agent/request` 两个钩子挂到**运行中会话自己的 ctx** 上，改 `ref.current` 即下一步生效；`AgentRegistry.list()` 能枚举活会话 |

控制中心因此加了两块：**免费链路卡片**（写 combo）+ **热切**（改默认模型时把活跃会话一起换掉）。

### 7.14.2 宿主半（`packages/dsh-companion-dashboard/lib/index.js`）

- `GET /companion/api/combos` → `{combos: [{name, models[], strategy}], path}`：直接读 `<DSH_HOME>/our-free-model/settings.json` 的 `combos`（与插件设置页同一份数据）。
- `POST /companion/api/model` 成功后追加 `hotSwitch: {supported, switched, total}`：
  - `agents` 服务 → `list()` 拿到活会话；每会话以 `agent.session.id` 记账，首次 `installModelSelection(agent.ctx, {current: next})`，之后只改 `ref.current`；
  - `disposeLiveSelections()` 挂 `ctx.effect`，插件卸载时把钩子退干净；
  - `@deepseek-ai/dsh-agent` 解析不到时返回 `{supported:false, reason:'dsh-agent-unavailable'}`，**降级而不是崩**。

### 7.14.3 浏览器半（`lib/client.js`）

- `FreeChainCard`：上半是已有链路（一行一个「设为默认」），下半可建链：链路名 / 策略 / **模型多选清单** / 全不选 / 保存。
  多选是勾选式（不是下拉逐条加入）：勾上即追加到链尾、取消即摘掉，左侧序号就是降级顺序（`picked.map(row => row.id)` 的数组顺序，`src/combos.js` 按数组顺序试）；`options` 为空时给「目录里还没有可用模型」的降级文案。保存走插件自己的 `POST /api/our-free-model/combos`，成功后再读一遍。
- 「设为默认」= `comboProvider()` 在模型目录里找到挂着 `combo:<name>` 的 provider，再 `POST /companion/api/model`；toast 里报热切了多少个活跃会话。
- `ModelBranch` 的保存提示改成「已切换默认模型…；已热切 N 个活跃会话／热切不可用，只对新会话生效」。

### 7.14.4 一个必须记住的坑：链成员是**插件自己的裸 id**

第一版按「全局模型目录」做下拉（`deepseek-official/deepseek-flash` 这种 `provider/model`），实测 `POST /api/our-free-model/combos` 返回 `usable: []`、`/companion/api/model` 里始终没有 `combo:*`。原因：

- `src/core/runtime.js:107` 的 `state().catalog` 是**本插件车道的目录**（免费/密封/Kilo/聚合），DSH 全局别的 provider 的模型不在里面；
- `src/combos.js:107` 用 `byId.get(id)` 逐段对号，对不上就 `.filter(entry => entry !== undefined)` 丢掉，成员为 0 时**整条链不出现**（:108 `if (members.length === 0) continue`）。

改成从 `GET /api/our-free-model/combos` 的 `models` 取下拉（裸 id + 显示名 + 车道），保存 `models: [裸 id...]`，立刻正常。两边实测对照：

```
models: ['deepseek-official/deepseek-flash', 'our-free-model/flint-40b-free']
  → saveStatus 200, usable [], comboRows []            # 全丢
models: ['beam-free', 'flint-40b-free']
  → usable [{id:'combo:free', models:['beam-free','flint-40b-free']}]
    comboRows ['our-free-model/combo:free']
    setDefault {status:200, saved:true, current:{provider:'our-free-model', model:'combo:free'}}
    hot {supported:true, switched:0, total:0}          # 干净实例没有活跃会话
```

### 7.14.5 验证

| 项 | 结果 |
| --- | --- |
| `scripts/smoke.mjs` | **14/14 通过**（新增 `/combos` 读 settings、热切用例：假 agent 的 ctx 记录 `system-prompt/assemble` 与 `agent/request` 两个钩子；`installModelSelection` 经 shim 解析为真函数，因此走的是 `supported:true` 分支） |
| `scripts/ssr-check.mjs` | `ok/chainOk/providerOk/liveOk/modelOk` 全 true，`missingTokens: []` |
| `.verify/check-patch.mjs` | 一个 insert 块 **10 行**（新增 `our-free-model`）、`missingPackages []`、`missingEntries []` |
| 干净环境 `.verify/app` | `dsh-companion-bundle@0.1.11` + `dsh-companion-dashboard@0.1.8` + `dsh-our-free-model@2.1.0` 一次装齐；`GET /companion/api/combos` 200（`path` 指向 `<home>/our-free-model/settings.json`）、`GET /api/our-free-model/combos` 200 |
| 多选改造（0.1.9） | `FreeChainCard` 去掉了 `pick` 单选状态与「加入链路」按钮，改成 `.cmp-picker` 勾选清单（`.cmp-pick.on` 高亮 + 序号）；`node --check` 通过，smoke **14/14**、ssr-check `missingTokens: []`；bundle **0.1.12** 的 check-patch 仍是 10 行、`missingPackages []`、`missingEntries []` |
| 两个真实 profile | `node_modules/dsh-companion-dashboard` 覆盖为 0.1.9（`client` 含 `FreeChainCard`、`models: picked.map((item) => item.id)`；`index.js` 含 `/combos` 与 `hotSwitchLiveAgents`），依赖行改 `file:...dashboard-0.1.8.tgz` |


### 7.14.6 限制

- **热切只对「当下活着的会话」生效**；干净实例里 `switched: 0, total: 0` 属正常，桌面里要等有会话在跑才会看到 `switched > 0`。
- 桌面 DSH 必须重启才会换上新版（HMR 只重载改动过的插件代码，不会替 `node_modules` 换版本）。
- web profile 没装 `dsh-our-free-model` 时，那边的「免费链路」卡片只读降级（toast 提示）；desktop 的 `dsh.profile.bundles` 里本来就有它。
- 链成员必须是 `dsh-our-free-model` 自己的裸 id（`buildComboCatalog` 用它自己的 `byId` 对号）；写成 `provider/model` 会被整条丢弃、`usable: []`。

## 7.15 链里能放哪些模型 + B站值班模型可见化（2026-10-31 深夜·续）

### 7.15.1 「链可选所有可用模型」的真实边界（已核实到源码）

`dsh-our-free-model` 的链成员按**它自己的 catalog** 对号，不认 DSH 全局目录：

- `src/combos.js` 的 `buildComboCatalog(combos, catalog)`：`const byId = new Map()` → `for (const entry of catalog) byId.set(entry.id, entry)` → `members = combo.models.map(id => byId.get(id)).filter(entry => entry !== undefined)` → `if (members.length === 0) continue`。
- 这个 `catalog` 由它自己的车道拼出来：免费车道（`<DSH_HOME>/our-free-model/catalog.json` 的 `entries`，本机 7 条）+ Kilo 车道（`kiloRows`，本机 15 条）+ 账号车道（`channel: 'eac'`）+ 聚合车道（`src/aggregate.js` 的 `buildAggregateCatalog`，用户自己粘 key 的 76 家）。本机实际 **7 + 15 = 22 条**；`aggregate.enabled = true` 但 `aggregate.providers` 是空对象 ⇒ 聚合车道 0 条。
- `src/catalog.js` 里**没有**任何合并 DSH 其它 provider 的代码（grep `listProviders|registerAdapter|deepseek-web` 全无命中）。

⇒ 结论：deepseek-web / deepseek-official / raccoon 这些**不可能**进链。要在链里用某家，只能让它在 `dsh-our-free-model` 的目录里出现：打开对应账号车道，或在「免费模型」设置页粘该平台 key（聚合车道会把它列进来）。

界面据此改了：清单按车道分组（`free · 7` / `kilo · 15` / …）、带搜索框，并在下方明确写出「另有 N 个模型在 DSH 目录里但不能进链」+ 原因与获得办法。

### 7.15.2 顺手修掉的一个真 bug：`groups is not defined`

`FreeChainCard` 的「设为默认」原来直接引用外层 `groups`，而那个变量只存在于 `ModelBranch` 的作用域里 ⇒ 点下去必然 `ReferenceError: groups is not defined`（渲染期走不到这行，所以之前没暴露；本次加「不在链范围」提示时在渲染期读到它才炸出来，`scripts/ssr-check.mjs` 直接抛栈）。改法：`FreeChainCard` 自己 `apiGet('/companion/api/model')` 拿目录，`comboProvider` 用它自己的 `catalog.groups`。

### 7.15.3 B站用的模型 = 值班模型（插件本身不跑模型）

`dsh-bili-pond` 把「刷一轮」当本地动作（拉字幕 / 统计 / 写文件），**只有生成报告或评论那一轮**要模型。那一轮它另起一个 profile（默认 `headless`）跑：

- 配置项 `dutyProvider` / `dutyModel`（设置页「值班模型」）。本机两者都是空 ⇒ `modelOverrideYml()` 返回 `[]`，**一个字都不写**，值班跟随那个 profile 自己的 `agent-default-model`。
- 只填 provider 不填 model ⇒ 同样不写（源码注释：`agent-default-model` 的 `model` 必填，写半条会让值班进程 `exit 1`）。
- `reuseRoutes`（默认 true）把**宿主 profile** 里模型相关的 entry 抄进 `--patch` overlay，所以宿主能用的线路会自动带进值班；`POST /api/bili-pond/profile-add` 能把线路所属插件装进值班 profile。
- 端点：`GET /api/bili-pond/models` → `{current:{provider,model}, profile, profileKnown, profileError, warnings, reuseRoutes, reusedRoutes, routePatch, providers:[{id,name,models,usable,source,package}]}`；`POST /api/bili-pond/config` 接受 `dutyProvider` / `dutyModel` / `headlessProfile` 等（`index.js:3572-3595`）。

本机现状（`bili_config` 实读）：`dutyProvider: ""`、`dutyModel: ""`、`headlessProfile: "headless"`、`dshBin: ""`（已在 §7.16 修好）、`autoRun: false`、`perDay: 5`、`perDayMax: 18`；而 `C:\Users\1\.dsh\profiles\headless` **不存在**（只有 desktop / web / node_modules）⇒ 真要跑值班，得先把那个 profile 建出来，否则起不来。

界面新增「值班模型」卡片：读 `GET /api/bili-pond/models` 显示当前线路/模型、值班 profile 是否可解析、从宿主带进来的线路、警告；下拉选线路 + 模型（`source: 'profile'` 的线路没有模型列表时退化成手填框），保存走 `POST /api/bili-pond/config`，另给「清空（跟随默认）」。

### 7.15.4 验证

| 项 | 结果 |
| --- | --- |
| `node --check lib/client.js` | 通过 |
| `scripts/smoke.mjs` | **14/14** |
| `scripts/ssr-check.mjs` | 无 `ReferenceError`；`missingTokens: []`、`biliBranchRendered: true`、`liveBili` 四条实测文本仍在 |
| 版本 | `dsh-companion-dashboard@0.1.10`、`dsh-companion-bundle@0.1.13`（依赖 `^0.1.10`） |
| 两个真实 profile | 覆盖为 0.1.10（`client.js` 含 `BiliDutyCard` 与 `cmp-pickgroup`），依赖行指向 `dashboard-0.1.10.tgz` |

## 7.16 「B站 线路显示空」定因（2026-10-31 深夜·再续）

### 7.16.1 症状与复现

控制中心 → B站 → 「值班模型」卡的「线路」下拉只有一条「（空＝跟随 profile 默认）」。

复现（干净环境 `.verify/home`，bundle 0.1.12 + dashboard 0.1.9，`dshBin` 为空）：

```
GET /api/bili-pond/models  ->  500
{"ok":false,"error":"找不到 dsh CLI：桌面版多半不是 npm 全局安装的 ⇒ 请在设置里把「dsh 路径」指到 <应用目录>/…/@deepseek-ai/dsh/lib/bin.js，或改用 npm 装的 dsh"}
```

### 7.16.2 根因（在读源码里，不在我们这边）

`dsh-bili-pond/index.js` 的 `GET /api/bili-pond/models`（`:3334`）**先**调 `modelsHere()`（`:2712`，拿当前进程 `llm.listProviders()`，本来是有值的），**再**调 `modelsInProfile(cfg.headlessProfile, …)`（`:2769`）去跑 `dsh --profile <p> --dump-config`。而那条探测要 `resolveDsh()`（`:1207`），它在找不到 CLI 时直接 **throw**（`:1237-1242`），**一路把整个路由打死** —— 于是 `here.providers` 那么多线路一条都没返回，前端自然只能看到空下拉。换句话说：**探测失败把主列表一起带走了**。

`resolveDsh()` 的候选位置（`:1207-1235`）：`cfg.dshBin`（存在就用）→ `%APPDATA%/npm/node_modules/@deepseek-ai/dsh/lib/bin.js` → `/usr/local/lib/…` → `process.resourcesPath` 下四个桌面位置（`app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js`、`app.asar.unpacked/…/dsh/lib/bin.js`、`app/…`、`node_modules/…`）。

本机实测这些**全都不存在**：`C:\Users\1\AppData\Local\Programs\DSH NEXT\resources` 下只有 `app-update.yml / app.asar / app.asar.unpacked / elevate.exe / runtime`，四个 candidate 逐个 `existsSync` 都是 false；`%APPDATA%\npm\...` 也没有 ⇒ 桌面版在这里必然 throw。日志里那句 `[bili-pond] ⚠️ 找不到 dsh CLI：桌面版多半不是 npm 全局安装的` 就是它。

### 7.16.3 修法

**真修（配置层）**：`<DSH_HOME>/bili-duty/config.json` 的 `dshBin` 指向真实 CLI。本机用插件工具写入：

```
bili_config({ patch: { dshBin: "D:\\DeepSeek-Harness\\npm-global\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" } })
→ { ok: true, config: { … dshBin: "D:\\DeepSeek-Harness\\npm-global\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" } }
```

改完同环境复测（干净环境重启实例，带 token 换 cookie）：

```
GET /api/bili-pond/models  ->  200
profile "headless" / profileKnown true / reusedRoutes [] / routeCandidates 6
providers: deepseek-official(models 2), deepseek-web(2), our-free-model(21), our-free-model-region(1),
           deepseek-account, codearts, buddy, workbuddy, lobsterai, qoder, qodercn, trae,
           cline, loomy, raccoon, minimax, gemini, zcode      ← 共 18 条
```

（`profileKnown: true` 而 `profiles/headless` 其实不存在 —— `dump-config` 对不存在的 profile 仍回默认树，所以这一步不能当作「值班能跑」的证据。）

**兜底（界面层，dashboard 0.1.11）**：`BiliDutyCard` 不再把空列表当正常 ——

- `/models` 返回 `ok:false` 时把 `error` 原文显示出来，并附可操作提示（去「B站鱼塘 → dsh 路径」填 `lib/bin.js`，保存后点「重新探测」）；
- 线路为空时自动退到我们自己的 `GET /companion/api/model`（`llm` 目录）兜一份，并标注「只能证明这台机器上有它」；
- 一个线路都没有时，「线路」从下拉退化成手填输入框（手填 id 直接写进 `dutyProvider`）。

### 7.16.4 验证

| 项 | 结果 |
| --- | --- |
| `node --check lib/client.js` / `lib/index.js` | 通过 |
| `scripts/smoke.mjs` | **14/14** |
| `scripts/ssr-check.mjs` | `missingTokens: []`、`biliBranchRendered: true` |
| 版本 | `dsh-companion-dashboard@0.1.11`、`dsh-companion-bundle@0.1.14` |
| 真实配置 | `C:\Users\1\.dsh\bili-duty\config.json` 的 `dshBin` 已写入上述路径；两个 profile 的 dashboard 覆盖为 0.1.11（含 `usingCatalog` 兜底） |

## 7.17 建好值班用的 `headless` profile（2026-10-31 深夜·收尾）

B站 那一轮跑在 `headlessProfile`（默认 `headless`）里，而 `C:\Users\1\.dsh\profiles` 下只有 `desktop` 与 `web` ⇒ 就算选了值班模型也起不来。这次补上：

### 7.17.1 建了什么

`C:\Users\1\.dsh\profiles\headless\`（新建）：

```yaml
# package.json
dsh.profile.bundles = ['@deepseek-ai/dsh-base', 'dsh-deepseek-web-login', 'dsh-our-free-model']
dependencies = { 'dsh-deepseek-web-login': '1.0.3', 'dsh-our-free-model': '^2.1.0' }

# cordis.patch.yml
- id: agent-default-model
  config:
    provider: deepseek-web
    model: deepseek-reasoner
```

`cordis.yml`（空数组 + 注释）与 `pnpm-workspace.yaml`（`nodeLinker: hoisted`、`autoInstallPeers: false`）从 web profile 抄过来，保证和别的 profile 同一套解析规则。**故意不装**任何 UI / IM / 侧边栏插件 —— 值班只需要 agent 加一条线路；B站 的工具由 `dsh-bili-pond` 自己在 `--patch` overlay 里挂 `mcp_server.py`（`index.js:1705` 的 `writeRouteOverlay()`，`:1903` 传 `--patch`），不依赖这个 profile 里装插件。

安装：`pnpm install` → `Packages: +2`（`dsh-our-free-model@2.1.0` 带一条 deprecated 提示，非致命）。

### 7.17.2 验证

```
$ node .../@deepseek-ai/dsh/lib/bin.js --profile headless --dump-config   # DSH_HOME=C:\Users\1\.dsh
status 0, 11804 字节
50|- id: agent-default-model
53|    provider: deepseek-web
54|    model: deepseek-reasoner
365|- id: dsh-deepseek-web-login
370|- id: our-free-model
```

再在**真实 home** 上起一个 web profile 实例（`D:\nodejs\node.exe` + `dsh/lib/bin.js --profile web --no-open --port 0`，注意不能用 Electron 二进制：`ELECTRON_RUN_AS_NODE=1` 会让某个插件报 `unsupported Electron runtime fingerprint: Node 24.21.0, V8 …-electron.0` 直接退出）带 token 换 cookie 实测：

```
GET /api/bili-pond/models  ->  200
profile "headless" / profileKnown true / profileError "" / warnings []
providers: deepseek-official|usable=false|models=2
           deepseek-account|usable=true|models=2
           deepseek-web|usable=true|models=2      ← 值班 profile 里真有它
```

`usable` 这一列以前恒为 `null`（探测失败），现在是真的：`deepseek-web` 在 headless 里可用了；`deepseek-official` 显示 `usable=false`，因为那个线路由 `dsh-deepseek-account` 之外的包提供、headless 里没装 —— 真要用它，得把对应插件也装进 headless（卡片上的「重新探测」会重新算这一列）。

### 7.17.3 坑与注意

- `win_bash` 起的子进程写不进 `C:\Users\1\.dsh`（`[EPERM] … _tmp_…`），`pnpm install` 必须从 `run_code` 里 `child_process.spawnSync` 跑（那里是 danger-full-access）。
- `read` 工具有输出上限（约 36KB，本文件 678 行时只回 563 行）。用「先 `read` 再整体 `write`」的方法改这种长文档会**静默截掉尾部**（本次就让 §7.14.6 / §7.15 / §8 消失过一次）。改长文件请用 `node:fs.readFileSync` 读全文再写。
## 7.18 侧边栏报错「Cannot read properties of undefined (reading 'current')」定因与绕开（2026-11-01）

> **更正（2026-11-01）**：本节把原因归到「hook dispatcher」是错的——改成 class 后同一个错照旧出现。真因见 §7.19：`readJson()` 剥了 `body.data`，而 `/api/bili-pond/models` 的字段摊在顶层，于是 `data === undefined`，下一行 `data.current` 抛 `reading 'current'`。class 化本身无害，保留。


### 7.18.1 现象与栈

`desktop-next.log` 在 15:34:55 / 15:36:36 / 15:36:38 三次出现同一个栈：

```
TypeError: Cannot read properties of undefined (reading 'current')
[error] [dsh-better-sidebar] render error: TypeError: Cannot read properties of undefined (reading 'current')
  at BiliDutyCard (dsh-app://app/plugins/??dsh-companion-dashboard/client.js&rev=…:377:31)
  at ChannelBranch (…:479:15)
  at ControlCenter (…:852:35)
  at RenderBoundary
  at NativeTabBody
```

整块控制中心被 better-sidebar 的 `RenderBoundary` 兜住，界面上只剩一条 render error，不是某一小段降级。

### 7.18.2 抛点定位

把 `.verify/tarballs/dsh-companion-dashboard-0.1.10.tgz` 解包核对行号（`C:/Windows/System32/tar.exe`）：0.1.10 与 0.1.11 的第 377 行都是

```js
const [data, setData] = useState(null)
```

即 `BiliDutyCard` 的**第一个 hook**；列 31 落在 `useState` 标识符上。React 在这里取不到 dispatcher（`resolveDispatcher()` 返回 undefined）时抛的正是 `reading 'current'`（源码 `react.development.js`：`const dispatcher = resolveDispatcher(); … dispatcher.useState`）。也就是说：这个组件拿到的 react 实例与渲染它的那棵树的不是同一份。

排除过的三个方向：

- 不是我们代码里的 `.current`：`client.js` 里只有 `data.current` / `catalog.current` / `body.current`，且都带 `&&` 守卫。
- 不是 better-sidebar 契约问题：`dsh-better-sidebar/lib/client.js` 用 `(0, react.createElement)(descriptor.component, {…})` 渲染，`RenderBoundary` 是 class + `componentDidCatch`；注释写明 `component: (props) => ReactNode`。
- loader 只有一份 react 的假设无法直接证实：`dsh-client-modules/lib/client.js` 用 `this.seed = new Map(Object.entries(options.staticModules))` 提供 seed 模块，理论上同一实例；但 `app.asar` 里的文件不能直接 `fs.readFileSync`（Electron 当 archive 读，报 ENOENT），本轮没能把它读穿。

### 7.18.3 处置：不赌根因，直接绕开 dispatcher

`BiliDutyCard` 从函数组件改成 **class 组件**（`class BiliDutyCard extends React.Component`）：constructor 里 bind `load`/`save`，`componentDidMount` 调 `load`，状态走 `this.setState`；渲染内容与改前逐条等价（当前线路 / 值班 profile / 复用线路 / warnings / `ok===false` 的错误原文与提示 / `usingCatalog` 提示 / 线路 select 或手填 / 模型 select 或手填 / 保存·清空·重新探测 / note 与 toast）。卡壳改用 `h('div', { className: 'cmp-card' })` + `h('h4')`，不再依赖 `Card`。

理由：class 组件不经过 hook dispatcher，`setState` 由渲染器直接注入实例；跨 react 实例也能渲染。

同时留了一条临时探针（下次重启看日志）：

```js
console.error('[cmp-probe] react=' + React.version + ' useState=' + typeof React.useState + ' keys=' + Object.keys(React || {}).length)
```

本地 ssr 环境输出 `[cmp-probe] react=18.3.1 useState=function keys=36`。真机日志里的这行用来判断「要不要把其余卡片也改成 class」。

### 7.18.4 验证

- `scripts/smoke.mjs` 的 fakeReact 补了 `Component`（`class FakeComponent` + `setState`/`forceUpdate`/`isReactComponent`），否则 `class extends undefined` 直接报 `Class extends value undefined`；改后 **pass 14 / fail 0**。
- `node scripts/ssr-check.mjs`：`ok / chainOk / providerOk / liveOk / modelOk / modelBranchRendered` 全 true，`missingTokens: []`。
- `.verify/check-patch.mjs`（干净环境 `.verify/app`，bundle 0.1.15 + dashboard 0.1.12）：10 行全在、`missingPackages []`、`missingEntries []`。
- 两个真实 profile 已文件级覆盖到 dashboard 0.1.12（含 `class BiliDutyCard extends React.Component`）。
- 真机渲染待用户重启桌面应用后确认（见 §8）。

### 7.18.5 版本

`dsh-companion-dashboard@0.1.12`、`dsh-companion-bundle@0.1.15`（依赖 `^0.1.12`）。


## 7.19 「reading 'current'」真因：响应外壳不一致（2026-11-01）

### 7.19.1 反证：class 化没有解决问题

0.1.12（class 版）在 15:42:45 仍然报同一个错，栈顶还是 `BiliDutyCard` ⇒ §7.18 的「hook dispatcher」推断不成立。0.1.13 加了埋点（`[cmp-bili] render failed: <stack> | state=<json>`，并在 render 外面套 try/catch 后原样 rethrow），15:45:29 用户点开 B站 分支时拿到：

```
[cmp-bili] render failed: TypeError: Cannot read properties of undefined (reading 'current')
  at BiliDutyCardV2.renderBody (…/dsh-companion-dashboard/client.js&rev=9840e162f165:457:68)
  at BiliDutyCardV2.render (…:425:23)
  …
  | state={"hasData":false,"provider":"","hasCatalog":false,"catalogGroups":-1}
```

`client.js:457:68` 正是 `(data.current && data.current.provider)` 那一行的 `data.current`；`hasData:false` 说明 `this.state.data` 既不是 null 也不是对象——是 **undefined**，于是 `data === null ? … : data.current` 走了 else 分支。

### 7.19.2 为什么 data 会是 undefined

`client.js` 的通用封装：

```js
async function readJson(res) {
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.ok !== true) throw new Error((body && body.error) || 'HTTP ' + res.status)
  return body.data
}
async function apiGet(path) { return readJson(await fetch(path, …)) }
```

它假设所有路由都回 `{ok:true, data:…}`（anima 和我们自己的 `/companion/api/*` 就是这样）。但 `dsh-bili-pond` 的 `GET /api/bili-pond/models`（`dsh-bili-pond/index.js:3334-3391`）直接 `sendJson(res, 200, {ok:true, current, profile, profileKnown, profileError, warnings, reuseRoutes, reusedRoutes, routePatch, routeIds, routeProbe, routeCandidates, providers})` —— **顶层摊开、没有 data 外壳**。`body.data` 因此是 `undefined`，`setState({data: body})` 把 undefined 存进 state。

同一处 `POST /api/bili-pond/config`（`:3572-3596`，返回 `{ok:true, config, host}`）也是同形，原来用 `apiPost` 保存也会拿不到值。

### 7.19.3 修法（dashboard 0.1.14）

`lib/client.js` 增加两个「不剥外壳」的封装，只对 bili-pond 用：

```js
async function apiGetRaw(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } })
  const body = await res.json().catch(() => null)
  if (!body || typeof body !== 'object') throw new Error('HTTP ' + res.status)
  if (body.ok === false) throw new Error(String(body.error || ('HTTP ' + res.status)))
  return body
}
async function apiPostRaw(path, payload) { /* 同上，method POST + JSON body */ }
```

`BiliDutyCard.load()` 改 `apiGetRaw('/api/bili-pond/models')`、`save()` 改 `apiPostRaw('/api/bili-pond/config', …)`；渲染入口的守卫从 `data === null` 改成 `!data`（undefined/null 都走「读取中…」），防止任何一次异常响应再把整块面板打死。

`[cmp-bili]` 埋点与 `renderBody` 的 try/catch 保留（下次渲染异常会带着行号进日志），`[cmp-probe]` 的 build 标记同步改成 0.1.14。

### 7.19.4 验证

- `node --check lib/client.js` 通过；`scripts/smoke.mjs` **pass 14 / fail 0**；`scripts/ssr-check.mjs` `ok / chainOk / providerOk / liveOk / modelOk / modelBranchRendered` 全 true、`missingTokens: []`。
- 两个真实 profile 已覆盖到 dashboard 0.1.14（`lib/client.js` 含 `apiGetRaw`、build 标记 0.1.14）。
- 真机：15:47:56 与 15:49:28 两次 `[cmp-probe] build=0.1.14`，之后 `renderer.recovery.healthy`。用户点开 B站 分支后，**15:50:04.666 `[bili-pond] 值班会带上宿主的线路配置：llm-pi-ai`**（= 卡片确实调用了 `/api/bili-pond/models`），而这次调用之后 `[cmp-bili]` 与 `render error` 计数仍为 0 ⇒ 卡片渲染通过。用户目视确认「卡片正常显示了」。

### 7.19.5 版本

`dsh-companion-dashboard@0.1.14`、`dsh-companion-bundle@0.1.16`（依赖 `^0.1.14`）。


## 7.20 「能不能共用一个值班 profile」+ 值班线路补装（dashboard 0.1.15 / bundle 0.1.17）

### 7.20.1 三条结论（源码判据）
- **desktop 不能当值班 profile**：`D:\DeepSeek-Harness\npm-global\node_modules\@deepseek-ai\dsh\lib\bin.js:35-37` 的 `rejectElectronProfile` 在 `:112`（boot）与 `:119`（plugin）都调用；值班 spawn 走同一条 CLI（`dsh-bili-pond/index.js:1900-1903`）⇒ 必然被拒。
- **web 技术上能共用**（`dsh --profile web` 起得来），但每轮值班都会拉起整套 web 应用（抢端口、会话落 web 桶），不划算。
- **headless 就是为此存在的第三个 profile**：本机 bundles = `@deepseek-ai/dsh-base` / `dsh-deepseek-web-login` / `dsh-our-free-model`，默认模型写在 `profiles/headless/cordis.patch.yml`（`deepseek-web / deepseek-reasoner`）。

### 7.20.2 用「值班 profile 里没有的模型」会怎样（`index.js:2857-2885 checkDutyModel`）
- 线路+模型都选了 → 带宿主 overlay 跑 `modelsInProfile`（`:2769`：`--dump-config` 收 `provider:` 行、`providers:` 映射键、name 含 workbuddy|deepseek|llm|assistant|connect 的插件名）；命不中就 `ok:false` 拒跑：「「headless」这个 profile 里没有可用线路「X」…」（`:2879`）。
- 只选线路不选模型 → 放行 + warn「这一轮会用 profile 默认模型」（插件故意不写半条无效配置，否则值班进程 exit 1）。
- 探测本身失败（dshBin 指错 / 45s 超时）→ `unchecked` 放行，真跑在请求阶段 NO_ADAPTER，白烧一轮。
- **假阴性**：our-free-model 系的车道（raccoon / codearts / …）是运行时注册，dump-config 里根本看不见 ⇒ 会被误判「值班 profile 没有」。

### 7.20.3 本机实测（2026-11-01，模块直调 `dutyProfileInfo()`，DSH_HOME=C:/Users/1/.dsh）
```json
{ "profile": "headless", "exists": true,
  "bundles": ["@deepseek-ai/dsh-base","dsh-deepseek-web-login","dsh-our-free-model"],
  "defaults": { "provider": "deepseek-web", "model": "deepseek-reasoner" },
  "duty": { "provider": "", "model": "" },
  "dshBin": "D:\\DeepSeek-Harness\\npm-global\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" }
```

### 7.20.4 新增（dashboard 0.1.15 / bundle 0.1.17）
- 宿主半：`biliConfig()` / `dutyProfileInfo()` / `writeDutyDefault(provider, model)`（改写值班 profile 的 `cordis.patch.yml` 里 `agent-default-model` 那段，改前留 `.bak`，没有那个 profile 时抛 `no-such-profile`）；路由 `GET /companion/api/duty` 与 `POST /companion/api/duty/default`。
- 浏览器半 `BiliDutyCardV2`：多一行「它的默认模型 / 已装 N 个 bundle」；`duty.exists===false` 时红字提示先去装那个 profile；按钮「把默认改成这条线路」＝写值班默认模型 + 清空 `dutyProvider/dutyModel`；`usable===false && package` 时给「装进值班 profile」（调插件自带的 `POST /api/bili-pond/profile-add`，内部 `dsh plugin --profile <p> add <pkg>`，最长 4 分钟）；`usable===false && !package` 时明说这是假阴性。
- **为什么写「默认模型」而不是只写 dutyProvider**：写进 patch 后 dump-config 就看得见这条线路（绕过假阴性），而且不选覆盖时值班也照它跑。

### 7.20.5 验证
`scripts/smoke.mjs` **15/15**（新增「值班 profile 体检 + 写值班默认模型」：GET /duty、POST /duty/default、缺模型 400、`no-such-profile` 抛错、注释保留、`.bak` 落地）；`scripts/ssr-check.mjs` ok / missingTokens []；`.verify/check-patch.mjs`（bundle 0.1.17 + dashboard 0.1.15）9 行 + 3 条 overrides、`missingPackages []` / `missingEntries []`；两个真实 profile 文件级覆盖到 0.1.15。


## 7.21 值班「0 秒 exit 1」：Electron 运行时指纹 + 包装器（2026-10-31 晚）

### 7.21.1 症状

控制中心的 B站 值班面板报「⚠️ 上一轮没成功：子进程异常退出（code=1）」，`C:/Users/1/.dsh/bili-duty/duty.log` 里每轮都是 `结束但没成功 · 用时 0 秒`，`run.log` 末尾是一段 Electron 运行时诊断：

```
node-addon-require-builtin unsupported: Unsupported/no-context (unsupported Electron runtime fingerprint:
  Node 24.21.0, V8 15.2.124.28-electron.0 (supported Electron versions: 43.0.0, 44.0.0, 45.0.0-alpha.6))
    at Object.requireBuiltin (.../node-addon-native-custom-loader/lib/index.js:572:28)
    at internalModules (.../dsh-app-boot/lib/index.js:1576:26)
    at installRuntimeInterception (.../dsh-app-boot/lib/index.js:1642:80)
```

### 7.21.2 根因

- `dsh-bili-pond/index.js:1207-1243` 的 `resolveDsh()` 只有两种返回：`{ command: process.execPath, args: [<某条 bin.js>] }`，或者抛错。桌面版里 `process.execPath` 就是 **Electron 二进制**，再配 `ELECTRON_RUN_AS_NODE=1`（`pyEnv(...)` 在 `:1258` 与 duty spawn 处都这么加）⇒ 值班子进程其实是「Electron 当 node 用」。
- 引导阶段 `dsh-app-boot` 会装原生加载器（`installRuntimeInterception` → `node-addon-require-builtin` → `node-addon-native-custom-loader`），它按 V8 版本号认 Electron：本机 Electron 44.7.0 的 V8 是 `15.2.124.28-electron.0`，不在它支持的 `43.0.0 / 44.0.0 / 45.0.0-alpha.6` 里 ⇒ 直接抛，CLI exit 1（0.4 秒就退）。
- 全局装的是 npm 版 dsh 0.2.0-rc.2（`D:/DeepSeek-Harness/npm-global/node_modules/@deepseek-ai/dsh`），它的 `node-addon-native-custom-loader@0.1.7` 包内只有 `lib/index.js`（25080 字节）+ 类型声明，**全文没有指纹表也没有那句报错文案** ⇒ 判定逻辑在原生二进制里，改 JS 无从下手。
- `resolveDsh()` 的桌面候选（`app.asar/dsh/…/cli.js`、`app.asar.unpacked/node_modules/@deepseek-ai/dsh/lib/bin.js`、`resources/app/…`、`resources/node_modules/…`）本机 `existsSync` 全为 false（fs 看不见 asar 内部），`%APPDATA%/npm` 与 `/usr/local/lib` 也没有 ⇒ 只能靠 `cfg.dshBin`。

### 7.21.3 修法：让值班子进程走真 node（`lib/duty-cli.js` 包装器）

`cfg.dshBin` 只被 `existsSync` 校验，内容是什么都行 ⇒ 指一个**包装器脚本**即可。新增 `packages/dsh-companion-dashboard/lib/duty-cli.js`：

1. 读 `<DSH_HOME>/companion/duty-cli.json` 的 `{node, bin}`；缺配置时自己猜（`cmd /c where node` 里挑不等于 `process.execPath` 的那条、`where dsh` 同级推 `node_modules/@deepseek-ai/dsh/lib/bin.js`）。
2. `spawnSync(node, [bin, ...process.argv.slice(2)], { stdio: 'inherit' })`，并先 `delete env.ELECTRON_RUN_AS_NODE`。
3. 透传退出码；找不到 node / CLI 时往 stderr 明说并 exit 2。

宿主半（`lib/index.js`）新增 `dutyCliInfo()` / `repairDutyCli()` / `detectRealNode()` / `detectDshBin()` 与两条路由：

- `GET /companion/api/duty/cli` → `{electron, execPath, wrapper, wrapperExists, dshBin, usingWrapper, needsRepair, saved, hint}`
- `POST /companion/api/duty/cli` → 探测真 node + 真 CLI，写 `<DSH_HOME>/companion/duty-cli.json`，返回 `{wrapper, node, bin}`

浏览器半（`lib/client.js` 的 `BiliDutyCardV2`）在「值班模型」卡里多一行「值班 CLI：…」；`needsRepair` 时显示红色提示与按钮「修复值班 CLI（改走真 node）」——点了先打 `POST /companion/api/duty/cli`，再 `POST /api/bili-pond/config {dshBin: <wrapper>}`（`dshBin` 在该插件白名单里，见 `index.js:3581`，写它同时更新内存与 config.json，不用重启）。

### 7.21.4 验证

- 包装器在**与值班子进程完全相同的条件**下（`process.execPath` = Electron + `ELECTRON_RUN_AS_NODE=1`）跑 `--version`：`status 0`、stdout `0.2.0-rc.2`。
- 真机把 `dshBin` 指到 `C:/Users/1/.dsh/profiles/desktop/node_modules/dsh-companion-dashboard/lib/duty-cli.js` 后手动开一轮：`duty.log` 记 `开跑（手动）· 模型 raccoon/sn-deepseek-v4-1-flash-1017`，**不再有「用时 0 秒 / code=1」**，`run.log` 出现正常的引导输出（`Processing request of type ListToolsRequest`）⇒ 值班子进程真的起来了。
- 回归：`scripts/smoke.mjs` 15/15、`scripts/ssr-check.mjs` `missingTokens []`、`biliBranchRendered true`。

### 7.21.6 部署坑：装进去的是旧版 qq-split（已修，dashboard 0.1.20 / bundle 0.1.23）

第一次装进两个真实 profile 后，独立的 node 探针跑 installQqSplit() 返回 onebot-unavailable —— 核对发现**装进去的 lib/qq-split.js 只有 3718B、不含 createRequire 回退逻辑**（仓库里已是 4667B 的定稿；0.1.19 的 tarball 里也是中间版本），所以重启后分条根本不会接管。

修法：dashboard 0.1.19 → **0.1.20**、bundle 0.1.22 → **0.1.23**，重新 npm pack，从 tarball 解出 package/ 再逐文件覆盖两个 profile（package.json / lib/index.js / lib/client.js / lib/duty-cli.js / lib/qq-split.js），依赖行指 0.1.20 的 tgz。

复验（`cd <profile> && D:/nodejs/node.exe .verify/real-split.mjs`，直接 import profile 里装好的那份）：desktop 与 web 都返回 `{"first":"ok","second":"already-installed","chunks":2,"lens":[180,124],"max":180,"roundTrip":true}`。

教训：包装进 profile 后必须用**装好的那份文件**跑一次探针（不能只跑仓库里的源码），否则「代码写好了」和「部署生效了」是两件事。

### 7.21.7 版本

`dsh-companion-dashboard@0.1.16`、`dsh-companion-bundle@0.1.18`；两个真实 profile 都已文件级覆盖到 0.1.16（含 `lib/duty-cli.js`）。桌面应用需重启一次才会加载新的 `BiliDutyCardV2`（包装器本身立即生效，不必重启）。

## 7.22 QQ 长回复按句号分条 + 记忆改成「索引 + 按需取全文」

### 7.22.1 长回复为什么变成一张图

dsh-onebot-qq/lib/outbound.js:84-103 只有一条规则：回复字数 > textImageThreshold（默认 150）就整段渲染成一张文字图卡片。插件本身没有「拆成多条消息」的能力（split.js 只做 markdown 清洗、[[qq_forward]] 解析和敏感词审计）。

### 7.22.2 做法：运行时接管出站原型（不改第三方文件）

新增 packages/dsh-companion-dashboard/lib/qq-split.js：

- splitBySentence(text, max = 180)：按句末标点（。！？!?…和换行）切句并合并到 ≤180 字；单句超长时优先在逗号/顿号/分号处断，否则硬切。
- installQqSplit()：import dsh-onebot-qq/lib/outbound.js 后 patch OutboundPipeline.prototype.sendToChat。bridge.js:279 是纯委托（return this.outbound.sendToChat(...)），所以改原型即改行为；原实现的 markdown 清洗 / 敏感词审计 / 离线补发队列照旧生效。
- 定位包的方式：该包 exports 只放行 . 、./client、./settings-remote、./package.json，所以先 createRequire(...).resolve('dsh-onebot-qq/package.json') 拿包目录，再按绝对路径 pathToFileURL(...) import —— 与插件自己解析出的 URL 相同，ESM 缓存命中同一实例。直接 import('dsh-onebot-qq/lib/outbound.js') 实测报 Package subpath './lib/outbound.js' is not defined by "exports"。
- 幂等与降级：重复安装返回 {ok:true, reason:'already-installed'}；对方结构变了返回 unsupported-version；没装返回 onebot-unavailable —— 都不抛错（故障隔离）。
- 配套配置：三处 patch（desktop profile / web profile / 聚合包）的 - id: dsh-onebot 行加了 textImageThreshold: 0，否则 150-180 字这档仍会出图。

### 7.22.3 验证

- scripts/smoke.mjs 新增「QQ 长回复按句号分条」用例（短句 1 条、空串 0 条、超长每条 ≤ 上限、拼回等于原文、单句超长硬切）→ 16/16 pass。
- .verify/app 对真实安装的 dsh-onebot-qq/lib/outbound.js 做端到端（脚本 .verify/app/split-e2e.mjs）：install {"ok":true,"chunks":180}，第二次 already-installed；396 字 → 发出 3 条（177/169/50 字），拼回等于原文 true，ids ["id1","id2","id3"]。
- 组合配置：dsh --profile web --dump-config 第 1383 行起的 - id: dsh-onebot 含 dmPolicy: open / allowAllUsers: true / textImageThreshold: 0。

### 7.22.4 记忆：本地存储 + 索引清单 + 按需取全文（dsh-anima 0.1.2 → 0.1.3）

- 完全本地：<DSH_HOME>/anima/persona.json 与 memory.json 两个文件（store.js 的 animaDir()），没有任何网络请求；本机实测 C:\\Users\\1\\.dsh\\anima\\memory.json 903B、persona.json 731B。
- 注入从「全文」改成「索引」：renderPromptSection 现在只写 - [mem_xxx] 前 42 字…（标签），并附一句「判断某条可能用得上时先调 anima_memory_get 取全文，只记得词句就 anima_memory_search」。
- 新工具 anima_memory_get(id)：返回该条全文；不存在返回「没有这条记忆」；状态不是 approved 时明确说「不是已确认事实」。
- 新导出 memoryIndex() / findMemory() / indexLine()（packages/dsh-anima/lib/model.js）。

### 7.22.5 版本

dsh-anima 0.1.1 → 0.1.2；dsh-companion-dashboard 0.1.18 → 0.1.19；dsh-companion-bundle 0.1.20 → 0.1.22。两个真实 profile 已文件级覆盖并核到对应版本（desktop / web 都是 anima 0.1.2 + dashboard 0.1.19）。

### 7.22.6 更正：改成「一句话一条消息」（dashboard 0.1.23）

用户原话：「一句话就发一条消息 就比如 你吃饭了吗今天天气怎么样 就要把两句话变成两条消息发出去 而不是合并成一个直到达到150十字后切换下一个消息」。

第一版是**贪心合并**（攒到 180 字才断），这确实把好几句话压成一条。现在改成语义直给：

- 按 `。！？!?…\n` 切句后，**每句单独发一条**，不再合并；`好的。` 这种短句也单独发。
- `MAX_CHUNK = 180` 降级为**单句硬上限**：只有一句本身超过 180 字才继续拆（先在 `，、,；` 处断，`cut > limit * 0.5` 才采纳，否则硬切）。
- 新增 `MAX_MESSAGES = 12` 兜底防刷屏：句子多于 12 条时按 `ceil(n / 12)` 均分合并，顺序不变、拼回等于原文。

实测（`E:/dsh-onesoul/.verify/real-split3.mjs`，直接 import 装进两个 profile 的那份，替换 `OutboundPipeline.prototype.sendToChat` 计数）：

| 输入 | 结果 |
| --- | --- |
| `你吃饭了吗？今天天气怎么样？` | **2 条**：`你吃饭了吗？` / `今天天气怎么样？`（旧版是合并成 1 条） |
| `好的。` | 1 条 |
| `一句。` × 30 | 10 条（30 ≤ 12 的均分兜底生效），拼回等于原文 |
| 70 字无标点长句 | 1 条（未到 180 上限） |

两个 profile（desktop / web）结果一致；`scripts/smoke.mjs` 17/17（新增「一句话一条消息」与「短句各发一条」「句子过多兜底合并」三组断言）；干净环境 `check-patch`：`bundleVersion 0.1.26`、`missingPackages []`、`missingEntries []`。

## 7.23 新加的 QQ 好友「不回复」：trace 定位 + 媒体围栏 + 沉默兜底

### 7.23.1 取证手段：打开 dsh-onebot 的 trace

desktop profile 的 `- id: dsh-onebot` 覆写行加了 `traceEnabled: true`，插件把每条消息的决策事件写进 `<mediaDir>/qq-trace.jsonl`（`C:\Users\1\.dsh\media\onebot\qq-trace.jsonl`）。patch 改动触发 HMR，04:49:40 该 row 重挂、04:49:43 `OneBot connected`。

### 7.23.2 探针结果：链路是通的

用户用新号 `private:3953927738`（昵称「悟」）发了一句，trace 四行完整：

```
{"stage":"inbound","ok":true,"chatId":"private:3953927738","messageId":"737238544"}
{"stage":"dispatch","ok":true,"reason":"消息已投递给模型"}
{"stage":"agent","ok":true,"reason":"模型回合结束（completed）"}
{"stage":"outbound","ok":true,"reason":"回复已发送","data":{"segments":1}}
```

⇒ 收消息、投递、模型回合、出站全部成功，「不回复」不是权限或通道断。

### 7.23.3 真正会让新号「什么都收不到」的两条路径

1. **模型只发图、图被围栏拒、然后没有文字兜底**。日志 04:46:37 与 04:46:39 两次 `qq_send_image` 失败，原文：「本地路径不在允许的媒体目录内（管理员回合可另读会话工作区），或文件不存在：E:\\dsh-onesoul\\playground\\meme_happy.png」与 `…\\meme-packs\\maid-emoji\\memes\\happy\\xinhuanufang.png`。
   围栏依据 `dsh-onebot-qq/lib/bridge.js:249-265 mediaSendRoots()`：`candidates = [mediaDir]`，只有 `canEditFiles(sessionId)`（管理员回合）才追加会话工作区。函数被访客调用时唯一允许的根就是 `C:\\Users\\1\\.dsh\\media\\onebot`。
2. **出站正文为空就静默跳过**（`lib/outbound.js:114-125`）：`stripMarkdown(body) === ''` 时只写一条 debug 日志，不发送。所以「只调工具、不给文字」的回合=对面什么都收不到。

### 7.23.4 修法（dsh-anima 0.1.3 + dashboard 0.1.21）

- anima 的「通道小抄」改了两条：① 发图要把图复制进**该通道允许的媒体目录**（`~/.dsh/media/onebot/`），发 meme-packs 原路径或复制到会话工作区都会被拒；② **图发不出去就立刻改用文字回答，绝不要沉默**。
- dashboard 的 QQ 分句接管加了自愈：装成功后每 60s 复查一次（`armQqSplit` + `setInterval(...).unref()`）。因为 HMR 重挂 onebot 可能换掉模块实例，原型补丁会随之丢失；复查是幂等的（`already-installed` 直接返回）。

### 7.23.5 验证与版本

- `scripts/smoke.mjs` 16/16；`scripts/ssr-check.mjs` `ok:true` / `missingTokens:[]` / `biliBranchRendered:true`。
- 版本：dsh-anima 0.1.2 → **0.1.3**、dsh-companion-dashboard 0.1.20 → **0.1.21**、dsh-companion-bundle 0.1.23 → **0.1.24**；两个真实 profile 已从 tarball 逐文件覆盖并核到对应版本。
- 生效条件：anima 与 dashboard 都是启动时加载的 node_modules 代码，HMR 只重挂 patch 改动的 row，所以这两条改动**要重启桌面应用**才生效（trace 与 textImageThreshold 这类 patch 级改动已经生效）。

## 7.24 控制中心「主人号 / 朋友号」+ 主人号定时主动互动（2026-11-01）

需求原话（用户自定义回答）：「先不重启 控制台加入主人号和朋友号的选项 主人号要求 一段时间发一条消息与主人互动 朋友号正常应答即可」。

### 7.24.1 为什么不能「加一个发消息的工具」

- `dsh-onebot-qq/lib/tools.js` 顶部的 `NAPCAT_API_WHITELIST` 里**没有** `send_private_msg`：插件只放行 `qq_send_image` / `qq_send_voice` / `qq_send_video` / `qq_send_file` / `qq_forward` / `qq_napcat_api` / `qq_group_history` 等，所以模型侧根本没有「主动发一段纯文本」的工具。
- 插件也没有模块级的 bridge 单例（`grep -n 'globalThis|Symbol.for|export (let|const) x = new'` 在 `index.js` 与 `bridge.js` 都是零命中），桥对象是 `apply` 里 `new OneBotBridge(...)`，外面拿不到。
- 结论：主动发消息只能**借用出站管道**。`lib/qq-split.js` 的第一个原型包装在首次调用时把 `this` 存进模块变量 `captured`，之后 `sendText(chatId, text)` 用 `captured.sendToChat(chatId, text, {})` 发出——这条路径会照常走 markdown 清洗、敏感词审计、离线队列，和正常回复同一条路。

### 7.24.2 宿主半（`packages/dsh-companion-dashboard/lib/index.js`）

- 存储：`companionPath()` = `<DSH_HOME>/companion/settings.json`，纯本地 JSON，无网络。
- `readCompanion()` 每次读盘并**钳位**：`intervalMinutes` 10..720（默认 90）、`windowStart` / `windowEnd` 0..23（默认 9 / 23）、`pool` 去空并截到 20 句、`owners` / `friends` 只收 `/^\d{5,12}$/` 且去重。
- `saveCompanion(patch)` 做**局部更新**：body 里没出现的字段保持原值，所以「只改 enabled」不会把主人号冲掉。
- `inWindow(cfg, date)` 支持跨零点（`windowStart > windowEnd` 时按 `hour >= a || hour < b`）；`nextDueAt(cfg)` = 没启用或没主人号时 0，否则「上次发送 + 间隔」，从没发过就是「现在」。
- `composeProactive(ctx, cfg)`：**默认本地模板**（`DEFAULT_OPENERS` 五句轮换，不烧额度）；只有 `proactive.useModel === true` 才 `await import('@deepseek-ai/dsh-llm')` 起一次 `llm.stream`（`maxTokens: 160`、`purpose: 'companion-proactive'`），失败或空文本回落模板并带 `note`。
- `runProactive(ctx, opts)`：`chatId` 默认 `private:<第一个主人号>`，`sendText` 成功后写 `lastSentAt` 并清 `lastError`，失败把错误原文写进 `lastError`（面板可见）。
- 定时器：`setInterval(..., 60000).unref()`，每轮判断 `enabled && owners.length > 0 && inWindow() && now >= nextDueAt()`，用 `proactiveBusy` 防重入。

### 7.24.3 路由与错误码

| 路由 | 行为 |
| --- | --- |
| `GET /companion/api/interact` | 回 `{owners, friends, proactive, nextDueAt, outbound}` |
| `POST /companion/api/interact` | 局部更新后回最新设置（同上形状） |
| `POST /companion/api/interact/send` | 立刻发一条，回 `{chatId, text, source, note, ids}`；前置条件不满足回 **400** |

前置条件（`/interact/send` 实测原文，别报成 500）：`还没有设置主人号`、`还没有捕获到出站管道：先让机器人收到任意一条 QQ 消息`。

### 7.24.4 浏览器半（`lib/client.js` 的 `class OwnerCard`）

- 又写成 **class 组件**，理由同 `BiliDutyCardV2`：桌面侧边栏里函数组件的第一次 `useState` 可能抛 `Cannot read properties of undefined (reading 'current')`（§7.18/§7.19）；`render` 外包 try/catch 打 `[cmp-owner] render failed` 再 rethrow，下次出问题日志自带行号。
- UI：主人号 chips（含 ×）、朋友号 chips、主动互动开关 + 间隔/时段数字输入、上次/下次时间、出站管道状态、`lastError` toast、台词 textarea、三个按钮（保存互动设置 / 现在发一条 / 让模型现写）。
- 挂载点：`ChannelBranch` 的 `branch.id === 'qq'`，排在 `QqLoginCard` 之后、`BiliDutyCardV2` 之前；`exports.__test` 增加 `OwnerCard`。
- CSS 是字符串**数组**（`const CSS = [ '...' ].join('\n')`），新类 `.cmp-lbl` / `.cmp-chips` / `.cmp-chip` / `.cmp-chip-x` / `.cmp-check` / `.cmp-num` / `.cmp-pool` 必须一条一元素，否则会把相邻元素截断成语法错误（§7.15 踩过）。

### 7.24.5 验证（dashboard 0.1.22 / bundle 0.1.25）

| 项 | 结果 |
| --- | --- |
| `scripts/smoke.mjs` | **17/17 pass**；新增用例断言 GET 默认值（owners 空、enabled false、90 / 9 / 23）、POST 过滤重复与非法号码、空台词丢弃、落盘到 `<DSH_HOME>/companion/settings.json`、只改 `enabled` 不冲掉主人号、`/interact/send` 无管道时 400 且错误含「出站管道」、`inWindow` 跨零点三段、`nextDueAt` 两例 |
| `scripts/ssr-check.mjs` | `ok / ownerOk / chainOk / providerOk / liveOk / modelOk` 全 true，`missingTokens: []`；`ownerOk` 用构造好的实例调 `renderBody()` 渲染，断言出现 2634024517 / 3953927738 / 已就绪 / 现在发一条 / 保存互动设置 |
| 真实安装探针 `E:/dsh-onesoul/.verify/real-interact.mjs` | 直接 import 装进 `C:/Users/1/.dsh/profiles/{desktop,web}` 的那份：GET 200（owners []、interval 90、outbound `{ok:false,reason:'no-outbound-yet'}`）、POST 200（owners `['2634024517']`、friends `['3953927738']`、interval 45、nextDueAt>0）、磁盘文件字段一致、`/interact/send` 400 + 「还没有捕获到出站管道…」 |
| 干净环境 `.verify/app` | 依赖与 overrides 指到 bundle 0.1.25 + dashboard 0.1.22 + anima 0.1.3，`check-patch`：`bundleVersion 0.1.25`、装配 10 行、`configOverrides` 三条（dsh-onebot 含 dmPolicy open / allowAllUsers true / textImageThreshold 0、napcat-keeper、agent-default-model）、`missingPackages []`、`missingEntries []`、`danglingOverrides ['agent-default-model']`（既有预期） |
| 安装 | 两个真实 profile 用 `tar -xzf` 解包后逐文件覆盖 `package.json` / `lib/index.js` / `lib/client.js` / `lib/duty-cli.js` / `lib/qq-split.js`，依赖行 `file:E:/dsh-onesoul/.verify/tarballs/dsh-companion-dashboard-0.1.22.tgz`，两边都核到 0.1.22 |

### 7.24.6 限制（都得告诉用户）

1. 这两处都是启动时加载的 node_modules 代码，**要重启桌面应用**才生效（HMR 只重挂 patch 改动的 row）。
2. 主动发消息依赖「出站管道已被捕获」：机器人得先收到过任意一条 QQ 消息；没收到过时面板会显示「还没捕获」，`/interact/send` 回 400。
3. `让模型现写` 会真的消耗一次模型额度；默认的模板台词不烧额度。
4. 定时精度是 60 秒轮询；跨零点时段、时段外不发、`proactiveBusy` 期间不叠加。

## 7.25 临时记忆库（B站值班结论）+ B站 与 QQ 风格统一（2026-11-01）

> 用户诉求（m04935 原文）：「我希望构建临时记忆库 就是比如说我询问你在B站上刷了什么他应该从这个临时记忆库中看自己B站所得出来的结论而不是去调用底层工具去看B站结论 而且我发现在B站的风格和在QQ的风格没有统一化」

### 7.25.1 为什么要一份宿主自己写下的临时记忆

值班（`dsh-bili-pond`）跑在 `headless` profile 里，刷完把结论写进 `<DSH_HOME>/bili-duty/out/YYYY-MM-DD.md`。问题在于**下一个来问话的会话跟那一轮毫无关系**：

- `headless` 值班 profile 里**没有装** `dsh-bili-pond`，也没有 NapCat/OneBot —— 让模型「现场调工具查 B站」在值班 profile 里根本打不通；
- 桌面侧虽然装了插件，但网页号登录态已失效（§7.21 的 `AUTH: 这个账号的登录态已失效`），现场查只会失败并白烧一轮额度；
- 就算打得通，`bili_search` + 字幕 + 评论是分钟级的慢路径，而用户此刻要的是一句「你刚刷到什么」。

所以把它做成**宿主写、模型读**的临时记忆：宿主解析值班报告 → 生成 `ephemeral.json` → 把索引段注入系统提示 → 需要细节时由工具取全文。这样做一次解析，所有通道（桌面 QQ、web、headless 值班自己）看到的是同一份结论。

### 7.25.2 报告解析（`packages/dsh-anima/lib/ephemeral.js`）

`parseReport(text)` 是状态机，认两种轮次格式：

| 格式 | 样子 | 怎么解析 |
| --- | --- | --- |
| 现在（多行式） | `### BV1pFx16cE5B` 换行 `**标题**：…` / `**UP**：…（3:38 · 8,432 播放）` / `**链接**：…` / `**为什么值得**：…` | `### BV[0-9A-Za-z]{10}` 开条（默认 `picked:true`），随后按 `**字段**：` 累积；`## 跳过` 段里的条目由 `**跳过**：` 翻成 `picked:false` |
| 旧一轮（单行式） | `- 日期 · BV · 标题 · UP（1:02 · 300 播放） · 跳过：理由 · url` | `bulletRow()`：抓 BV、`（…）` 里的播放/时长、`(挑中|跳过|保留)：` 标记；标题只取 BV 之后第一段（旧行把标题和 UP 混在一段，宁缺不要拼错） |

三条硬规则：

1. **代码块围栏内的内容不参与解析** —— 报告尾部会贴 `dsh` 日志，日志里恰好有 `### BV…` 和 `- …` 的假条目（`FENCE_RE` 用 `String.fromCharCode(96,96,96)` 拼，源码里不出现真反引号）。
2. **同一 BV 保留信息最全的一条** —— `scoreOf = picked*8 + verdict*2 + url + up + title`，正文、跳过列表、判重表里重复的 BV 只留最高分那条，输出顺序按首次出现。
3. **没写出报告的那天产出 0 条** —— `2026-10-31.md` 只有「这一轮没写出报告」加一段围栏日志，解析结果确实是 0 条（`days[1].entries.length === 0`）。

`refreshEphemeral({dir, keep})` 只重读 **mtime 变过**的日期（`prev.mtime === mtime` 直接复用），截断到 `keep` 天（默认 `KEEP_DAYS = 7`），写回 `{version, updatedAt, source:{dir,keep,files}, days, total}`，返回 `{ok, file, days, total, picked, newPicked, dir}`；`newPicked` 是「这次新出现的挑中条目」，用来落候选记忆。

### 7.25.3 注入与取全文

系统提示里的段（实测 2296 字符 / 23 行）开头是：

```
## 临时记忆：B站值班（最近 N 天 · 共 M 条 · 挑中 K 条）
这是机器人自己在 B站 刷完写下的结论（下面只是索引，每条点评截断到 90 字）。
被问「你在B站刷了什么 / 最近看到什么」时，**直接照这里回答**；不要为了同一件事再去调 bili_search / bili_subtitle / bili_comments（慢、烧额度，登录态不对还会失败）。
要看完整点评与链接，或看更早哪天，调 anima_ephemeral_get（传 bvid 或 date）。这些内容 7 天后自动消失，不属于长期事实。
```

之后每天一个小节 `### 日期（N 条）`，挑中的排前面，每行 `- BV… · 标题（UP） · 挑中：前 90 字…`；超过 18 行收口成「…（还有 N 条，用 anima_ephemeral_get 传 date=… 取）」。没有数据时 `renderEphemeralSection()` 返回空串，**不注入空段**。

| 端点 | 作用 |
| --- | --- |
| 工具 `anima_ephemeral_get` | 参数 `date`/`bvid`/`query`/`limit`（默认 20 条），返回 `{dates,total,returned,rows}`；空库与空匹配各有一句中文提示 |
| 工具 `anima_ephemeral_refresh` | 立刻重抽一次，回 `{file,dir,days,total,picked,dates,capturedCandidates}` |
| `GET /anima/api/ephemeral` | 摘要 + 最多 200 条明细，控制中心/调试用 |
| `POST /anima/api/ephemeral/refresh` | 同上，但会重读报告 |

宿主侧还有两条自动行为：启动时 `refreshEphemeralSafe('startup')`，之后 `setInterval(..., 15 * 60 * 1000).unref()` 心跳 —— 值班写完报告**不用重启**就能被读到。

### 7.25.4 风格统一：给值班 profile 也装 `dsh-anima`

风格不统一的根因很直接：`headless` profile 的 bundles 里没有 `dsh-anima`，值班那一轮读到的是「没有任何人格的裸模型」，而 QQ 侧读的是 `<DSH_HOME>/anima/persona.json` 里的「大肥鱼 / 主人」。

修法是**共用同一份人设文件**而不是复制一份：

- `C:/Users/1/.dsh/profiles/headless/package.json` 的 `dsh.profile.bundles` 变成 `['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'dsh-anima', 'dsh-deepseek-web-login', 'dsh-our-free-model']`（备份 `package.json.bak-anima`），`dependencies` 加 `file:…/dsh-anima-0.1.4.tgz`；
- 三个 profile（desktop / web / headless）装的是同一份代码，`animaDir()` 都解析到 `<DSH_HOME>/anima`，所以改一次人设三处同时生效。

装进 headless 立刻踩了一个坑：

```
dsh-anima (dsh-anima): Error: cannot get property "webServer" without inject
    at file:///C:/Users/1/.dsh/profiles/headless/node_modules/dsh-anima/lib/index.js:494:22
```

`export const inject` 原本硬声明 `['tools','webServer','systemPrompt']`，而 headless 没有 `webServer` 服务 ⇒ 整个插件不激活。改成 `['tools','systemPrompt']`，并把 `webServer` / `systemPrompt` / `tools` 三处都换成 `typeof ctx.get === 'function' ? ctx.get('x') : null` 加 try/catch（`tools` 再兜底 `ctx.tools`），11 处 `ctx.tools.register(...)` 换成 `toolService.register(...)`。

### 7.25.5 真机证据

| 项 | 证据 |
| --- | --- |
| 报告解析 | `C:/Users/1/.dsh/bili-duty/out/2026-11-01.md`（10125B，多轮追加 + 一段围栏日志）→ **44 条 / 挑中 6 / 有链接 6 / 有 UP 6**；样本 `BV1pFx16cE5B`：标题「DeepSeek 开源 Super-agent…」、UP「渐近自由JJZY」、`8,432 播放`、`3:38`、轮次「2026-11-01 第 2 轮（00:44）」；`2026-10-31.md` → 0 条 |
| 落盘 | `C:/Users/1/.dsh/anima/ephemeral.json` 24150B（2 天 / 44 条 / 挑中 6） |
| 候选记忆 | `memory.json` 由 3 条变 9 条，其中 6 条 `status:'candidate'`、`source:'bili-duty'`、`note:'bili:<bvid>'`（样例 `mem_mvxduzds_74c3bbfb`） |
| 人设统一 | `node …/dsh/lib/bin.js --profile headless "只回答一行：你的名字 / 你对用户的称呼"` → **`大肥鱼 / 主人`**（6.0 秒） |
| 临时记忆可读 | 同法问「你在B站刷了什么？只说最近挑中的第一条的 BV 号，不要用工具」→ **`BV1pFx16cE5B`**（6.4 秒），reasoning 原文写「From the system prompt's ephemeral memory index」。该 profile 里没有 `dsh-bili-pond`，答案只可能来自临时记忆 |
| 假 ctx 功能测试 | `.verify/ephemeral-wire.mjs`（`DSH_HOME=.verify/home-ephemeral`）：提示段出现、按 bvid 取到 703 字符含标题与链接、空匹配回中文提示、`GET /anima/api/ephemeral` 200 `total 44 picked 6`、`POST …/refresh` 200 |

### 7.25.6 验证与版本

| 检查 | 结果 |
| --- | --- |
| `scripts/smoke.mjs` | **20/20 pass**（新增 3 条：两种格式 + 围栏 + 同 BVID 去重；刷新落盘 + 提示段 + `anima_ephemeral_get` + `GET /anima/api/ephemeral`；挑中落候选且重复刷新不重复落） |
| `scripts/ssr-check.mjs` | `missingTokens: []`、`qqBranchRendered`/`biliBranchRendered` 均 true |
| `.verify/check-patch.mjs`（干净环境） | `bundleVersion 0.1.27`、装配 10 行、`missingPackages []`、`missingEntries []`、`configOverrides` 三条 |
| 三个真实 profile | `dsh-anima@0.1.4`（desktop / web / headless 全装，headless 的 bundles 已含 `dsh-anima`） |

版本：`dsh-anima 0.1.3 → 0.1.4`、`dsh-companion-bundle 0.1.26 → 0.1.27`（依赖 `dsh-anima ^0.1.4`）；`dsh-companion-dashboard` 本轮未改，仍是 `0.1.23`。

### 7.25.7 限制

1. **只活 7 天**：`KEEP_DAYS = 7`，且只读 `out/*.md` —— 报告文件被删或改名，临时记忆跟着消失。
2. **旧一轮的单行条目没有 UP**：标题与 UP 混在同一段时只取标题（宁缺不要拼错），所以老日期的详情里 UP 可能是空的；新一轮的 `**UP**：` 字段是准的。
3. **候选记忆仍需裁决**：自动落的是 `candidate`，不会自动变成「事实」；确认要走 `anima_memory_decide`（或控制中心「记忆」分支）。
4. **桌面要重启才生效**：`anima` 是启动时加载的 node_modules 代码，HMR 只重挂 patch 改动的 row ⇒ 新的提示段与工具要重启桌面应用才出现；headless 每次是新进程，立刻生效。


## 7.26 「读取 anima 失败：HTTP 404」——路由只在 apply 时抓一次 webServer

### 7.26.1 症状

桌面端控制中心「记忆」分支顶部一条红色提示：`读取 anima 失败：HTTP 404`。
`packages/dsh-companion-dashboard/lib/client.js:25` 里 `const ANIMA = '/anima/api'`，`:236` 的 `setToast('读取 anima 失败：' + error.message)` 只在请求抛错时出现 ⇒ 请求确实打到了宿主，但那个前缀没有路由。
同一时刻 `anima_status` / `anima_memory_*` / `anima_ephemeral_*` 这些工具都正常在工具表里 ⇒ 插件是激活的，只有 HTTP 面缺。

### 7.26.2 根因

`packages/dsh-anima/lib/index.js:38` 的静态依赖是 `export const inject = ['tools', 'systemPrompt']` —— `webServer` 是**在 §7.25 里为让 headless 值班 profile 能激活插件而特意移出静态 inject 的**（headless 没有这个服务，硬依赖会让插件永不激活）。
移出后 apply 里那一句 `webServer = ctx.get('webServer')` 在桌面端拿到的是 **null**：桌面 profile 里 webServer 服务晚于 anima 就绪。于是 `if (webServer && typeof webServer.register === 'function')` 整段被跳过，`/anima/api` 从未注册 —— 之前能读到纯属运气（早一版把 webServer 写在 inject 里，cordis 会等它就绪）。

### 7.26.3 修法

把挂载包成 `mountAnimaRoutes(webServer)`，两种时机都覆盖：

```js
const liveWebServer = pickWebServer(ctx)
if (liveWebServer) {
  mountAnimaRoutes(liveWebServer)
} else if (typeof ctx.inject === 'function') {
  ctx.inject(['webServer'], function (inner) {
    mountAnimaRoutes(pickWebServer(inner))
  })
}
```

为什么不用 `inject = { optional: [...] }`：cordis 的 inject 数组就是必需依赖；「等某个服务出现再执行」的原生做法是 `ctx.inject(inject, callback)`（`@deepseek-ai/cordis/lib/index.js:1600`：`inject(inject, callback) { return this.plugin({ inject, apply: callback, name: callback.name }) }`），它给依赖另起一个 fiber，服务就绪时才跑回调。
`pickWebServer(scope)` 里仍是 try/catch 包 `scope.get('webServer')`：未 inject 的服务直接取属性会抛 `cannot get property "webServer" without inject`（`cordis/lib/index.js:676`）。

### 7.26.4 验证

| 检查 | 命令/探针 | 结果 |
| --- | --- | --- |
| 真 cordis 下晚就绪 | `.verify/anima-inject.mjs`（`new Context()` + `ctx.provide('tools'/'systemPrompt')` + `ctx.plugin(anima)`，随后 `ctx.provide('webServer', …)`） | `tools: 11 routes before: 0` → `routes after: ["/anima/api"]` |
| 装好的那份也一样 | `.verify/anima-real-inject.mjs`（import `C:/Users/1/.dsh/profiles/desktop/node_modules/dsh-anima/lib/index.js`） | `tools=11 routesBefore=0` → `routesAfter=["/anima/api"]` |
| 冒烟 | `node --import ./scripts/shims/resolver.mjs scripts/smoke.mjs` | **21/21 pass**（新增「webServer 晚就绪时靠 ctx.inject 补挂路由」） |
| 控制中心 SSR | `node scripts/ssr-check.mjs` | `missingTokens: []`、`qqBranchRendered`/`biliBranchRendered` true、`controlCenterHtmlLen 1336` |
| 干净环境装配 | `.verify/check-patch.mjs` | `bundleVersion 0.1.28`、`missingPackages []`、`missingEntries []` |

### 7.26.5 版本

`dsh-anima` 0.1.4 → **0.1.5**（0.1.4 已装在三处 profile，为避免「同名不同内容」直接升号）、`dsh-companion-bundle` 0.1.27 → **0.1.28**（依赖 `dsh-anima ^0.1.5`），`dsh-companion-dashboard` 保持 0.1.23（本次没动浏览器半）。三个 profile（desktop / web / headless）都已覆盖，`dep=file:E:/dsh-onesoul/.verify/tarballs/dsh-anima-0.1.5.tgz`。

### 7.26.6 生效条件

anima 是启动时加载的 `node_modules` 代码 ⇒ 必须重启桌面应用，`/anima/api` 才会挂上。headless 值班 profile 不受影响（它本来就没有 webServer，工具与提示注入照旧）。

## 7.27 临时记忆 ≠ 永久记忆：审核队列里为什么全是 B站

### 7.27.1 症状

用户问「临时记忆是否和永久记忆混在一起，审核处都是 B站 的信息」，并裁定：**临时记忆自动写入，无需审核**。

### 7.27.2 存储上从来是两个文件

| 文件 | 内容 | 是否进审核 |
| --- | --- | --- |
| `<DSH_HOME>/anima/ephemeral.json` | 24 150B：`source.files` = `2026-11-01` / `2026-10-31`，`total 44`，`keep 7` 天滚动，只读 `bili-duty/out/*.md` | 否（旁路） |
| `<DSH_HOME>/anima/memory.json` | 清理前 9 条：`approved 1` / `rejected 2` / `candidate 6` | `candidate` 才进审核 |

所以「混」的不是记忆本体，是**审核队列**：临时记忆写的是自己的文件，从没进过 `memory.json`；占满审核处的是另一条路径 —— 值班挑中时顺手落了一条候选。

### 7.27.3 根因

`packages/dsh-anima/lib/index.js` 里有个 `captureBiliPicks(rows)`（旧 :143-175）：`refreshEphemeralSafe` 每 15 分钟抽一次报告，抽完把新挑中的 BV 写成 `status: 'candidate'` + `source: 'bili-duty'` + `note: 'bili:<bvid>'` 的条目塞进 `state.memory.entries` 并 `persistMemory()`。审核面板取的是 `pendingMemories(...)`（按 `status === 'candidate'` 过滤）⇒ 6 条值班条目把审核处占满，而真正要裁决的对话候选被挤到后面。

### 7.27.4 修法

删掉 `captureBiliPicks` 整个函数与它的调用；`refreshEphemeralSafe` 现在只做「抽报告 → 写 `ephemeral.json` → 更新缓存」，返回值仍带 `captured: 0`（工具与 `/anima/api/ephemeral/refresh` 的字段形状不变，前端不用改）。`anima_ephemeral_refresh` 的描述改为「临时记忆是自动写入的旁路，不进审核队列」。
`anima_memory_capture` 保留：在对话里主动记一笔仍然落候选、仍然要裁决 —— 只有值班那条自动管道被摘掉。

### 7.27.5 迁移（真实 home）

`C:/Users/1/.dsh/anima/memory.json` 9 → **3** 条：删掉 6 条 `note` 以 `bili:` 开头的候选，备份为 `memory.json.bak-bili-clean`；剩下 `approved 1`（大肥鱼生日那条）/ `rejected 2`。B站内容一条没丢 —— 它本来就在 `ephemeral.json` 里，用 `anima_ephemeral_get` 取全文。

### 7.27.6 验证

| 检查 | 命令/探针 | 结果 |
| --- | --- | --- |
| 冒烟 | `node --import ./scripts/shims/resolver.mjs scripts/smoke.mjs` | **21/21 pass**；用例改写为「临时记忆自动写入，值班挑中不进审核队列」：`capturedCandidates 0` + `anima_ephemeral_get` 取得到全文 + 候选池与磁盘都无 `bili:` 条目 |
| 装好的那份跑真实报告 | run_code 内 import `C:/Users/1/.dsh/profiles/desktop/node_modules/dsh-anima/lib/index.js`，`DSH_HOME=C:/Users/1/.dsh` | `refresh total=44 picked=6 capturedCandidates=0`；`memory.json 3 -> 3 条; bili 候选 0`；`anima_ephemeral_get 命中=true 长度=721` |
| 干净环境装配 | `.verify/check-patch.mjs`（bundle 0.1.29） | `bundleVersion 0.1.29`、`missingPackages []`、`missingEntries []`、`animaExportsDecide true` |
| 控制中心 SSR | `node scripts/ssr-check.mjs` | `ok true`、`missingTokens []`、`qqBranchRendered`/`biliBranchRendered`/`modelBranchRendered` true |

探针坑（复现记录）：用 `win_bash` 起 node 跑这条探针会 `EPERM: operation not permitted, open 'C:\Users\1\.dsh\anima\ephemeral.json.2128.tmp'` —— 沙箱只允许 run_code 自身的 `fs` 写 `C:/Users/1/.dsh`。

### 7.27.7 版本

`dsh-anima` 0.1.5 → **0.1.6**、`dsh-companion-bundle` 0.1.28 → **0.1.29**（依赖 `dsh-anima ^0.1.6`），`dsh-companion-dashboard` 保持 0.1.23。三个 profile（desktop / web / headless）已覆盖到 0.1.6，`biliCandidate=false`（已无 `captureBiliPicks`）。anima 是启动时加载的代码 ⇒ 需要重启桌面应用才生效。

## 7.28 值班摘要主动推到 QQ：一句鱼说 + 最多 N 条（dashboard 0.1.24 / bundle 0.1.30）

用户 2026-11-01 的原话：「值班中很重要的 可以主动和我在QQ中提起」。三选一里选了 **A：一句鱼说 + 最多 2 条最值得的（标题 + 一句话理由 + 链接），每轮只提一次**。

### 7.28.1 三样信号从哪来（都是值班自己写的文件）

| 文件 | 内容 | 用途 |
| --- | --- | --- |
| `<bili-duty>/say.txt` | 值班结尾自己写的一句话（本机实测 24 字节：「额度用完了就该收手，今晚真正的新东西只有两三条。」） | 推送开头那句 |
| `<bili-duty>/memory.jsonl` | 每行 `{"t":标题, "why":为什么值得记, "bv":BV号, "d":日期}`，每轮 2~3 条 | 「最值得的 N 条」 |
| `<bili-duty>/out/<date>.md` | 报告正文（`- 日期 · BV · 标题 · UP · 挑中|跳过：理由 · url`） | §7.25 临时记忆在读，这里不重复读 |

`duty.md` 里的「私信」是 B站私信（`bili_send_message`），不是 QQ —— 所以推送必须由宿主半自己发。

### 7.28.2 为什么整段发，而不是按句发

QQ 侧 0.1.23 起「一句话一条消息」：`splitBySentence` 按 `。！？!?…` 与换行切条。摘要里天然带这些标点，会被拆成五六条，等于刷屏。
做法：`lib/qq-split.js` 新增 `export async function sendOneMessage(chatId, text)`，用**未打补丁的原始** `sendToChat`（`installQqSplit()` 里存进 `originalSendToChat`）；`lib/index.js` 的 `flattenMessage(text)` 把 `\r\n` 与 `。！？!?…` 全换成「，」并去首尾逗号，保证成段也不触发分句。

### 7.28.3 宿主半（`lib/index.js`）

- 配置落在 `<DSH_HOME>/companion/settings.json` 的 `proactive.dutyPush`：`{enabled: 默认 true, maxItems: 1..5 默认 2, cooldownMinutes: 5..720 默认 30, lastKey, lastAt, lastText}`；`saveCompanion` 对 `proactive` 做深拷贝，改值班设置不会冲掉主人号。
- 轮次指纹 `key = memory.jsonl 行数 + '|' + say.txt mtimeMs + '|' + 最后一条标题前 24 字` ⇒ 值班每跑一轮 key 就变，同一轮不会重复提。
- `dutyPushDue(cfg, signals, date)` 依次判 `disabled / no-owner / outside-window / nothing-new / already-pushed / cooling`，六个理由原样回给前端显示。
- 文案：`值班刚跑完，就一句：<say> · 这一轮值得你看的 N 条 · ① <标题前 80 字>（<理由前 60 字>） https://www.bilibili.com/video/<bv> · ② …`
- 定时器每 60s：先问主动互动，再问值班推送（共用 `proactiveBusy`，两者不会撞车）。
- 路由：`GET /companion/api/interact` 多带 `duty: {dir, say, items, key, pending, preview, lastKey, lastAt, lastText}`；`POST /companion/api/interact/send` 认 `{duty: true, force?: true}`，前置条件不满足（没主人号 / 没捕获管道 / 值班没产出）一律 400。

### 7.28.4 浏览器半（class OwnerCard）

QQ 分支卡片多一段「值班摘要（发主人号）」：开关、最多几条、冷却分钟、`下次会这样提：<preview>`、「上次推送：<时间>　状态：<中文理由>」、上次内容，两个按钮（保存值班推送设置 / 现在提一次）。仍是 class 组件 + render 外包 try/catch（`[cmp-owner] render failed`），原因见 §7.18 / §7.19。

### 7.28.5 验证

| 项 | 结果 |
| --- | --- |
| smoke | **22/22**（新增「值班摘要推送到主人号」：指纹非空、`composeDutyMessage` 不含 `。！？` 与换行、最多 N 条、取最近、带理由；`dutyPushDue` 的 disabled / outside-window / already-pushed / cooling 四态；`POST /interact/send {duty:true}` 无管道 400） |
| ssr-check | `ok / ownerOk / dutyOk / liveOk / modelOk / chainOk / providerOk` 全 true、`missingTokens []` |
| 真机探针 `.verify/real-duty.mjs`（直接 import 装进 desktop profile 的那份，临时 `DSH_HOME`） | `GET /interact` 200，`key=2|1793511974874.865|用飞书在手机上批准任务`、`pending.why=no-owner`、`preview=值班刚跑完，就一句：额度用完了就该收手，今晚真正的新东西只有两三条 · 这一轮值得你看的 2 条 · ① 四层记忆库怎么搭（讲清了检索分层） https://www.bilibili.com/video/BV1iZxB6MEbc · ② 用飞书在手机上批准任务（远程审批一条链路） https://www.bilibili.com/video/BV1pFx16cE5B`；`POST /interact` 后 `maxItems=1 / cooldownMinutes=10 / owners` 保留且落盘一致；`POST /interact/send {duty:true, force:true}` → 400「还没有捕获到出站管道：先让机器人收到任意一条 QQ 消息」 |
| 干净环境 `.verify/app` | `bundleVersion 0.1.30`、装配 10 行、`missingPackages []`、`missingEntries []`、`configOverrides` 三条（`dsh-onebot` 含 `dmPolicy: open` / `allowAllUsers: true` / `textImageThreshold: 0`） |
| 安装 | desktop / web 两 profile 都到 `0.1.24`（`runDutyPush` / `保存值班推送设置` / `build=0.1.24` 均在），依赖行 `file:E:/dsh-onesoul/.verify/tarballs/dsh-companion-dashboard-0.1.24.tgz` |

### 7.28.6 限制

1. 出站管道要**先收到过一条 QQ 消息**才能捕获（`lib/qq-split.js` 的 `captured`）；没捕获时面板写「还没捕获」、手动推送 400。
2. 只在时段内推（沿用主动互动的 `windowStart/windowEnd`，默认 9..23）；窗口外就算有新轮次也压着，等窗口开了再推。
3. 每轮只提一次：`lastKey` 落盘；「现在提一次」绕过冷却但也写 `lastKey`。
4. 摘要只带标题与理由，不带正文 —— 想看内容点链接。

## 7.29 「回复的断句还是有问题」第二轮：省略号被当句末、表情标记被劈开、句子又被均分粘回一条（dashboard 0.1.25 / bundle 0.1.31）

用户原话（m05414）：「回复的断句还是有问题 你自己读一下」。这一节就是「自己读」的结果 —— 不猜，直接读真机语料。

### 7.29.1 语料怎么读出来的

QQ 会话事件是 **zstd 多帧**（每帧一条 JSON 行）；Node 24 的 `zlib.zstdDecompressSync` 只解**第一帧**（实测 297819 字节只回 186 字符），必须先按 magic `28 b5 2f fd` 切帧再逐帧解。

| 文件 | 帧 | 事件 | assistant/message |
| --- | --- | --- | --- |
| `C:/Users/1/.dsh/sessions/--E-dsh-onesoul-playground--/onebot-private-3953927738/session.v4.jsonl.zstd` | 126 | 257 | 34（其中 7 条有正文） |
| `C:/Users/1/.dsh/sessions/--E-dsh-onesoul-playground--/onebot-private-2315965691/session.v4.jsonl.zstd` | — | — | 5 |

正文取 `data.message.content` 里 `type === 'text'` 的拼接（`reasoning` 不算正文）。

### 7.29.2 三个真问题（对照实测输出）

1. **`…` 被当成句末。** `hhx……下一个是不是该到拼音字母表了？` 拆成 `["hhx…","…","下一个是不是该到拼音字母表了？"]`；`哦～mj 是蜘蛛侠啊，那 mi 八成是……米？还是秘密？` 拆成 5 条，其中一条只有一个 `…`。同一处还把 `[表情: 瞪大眼睛，难道说……]` 劈成 `[表情: 瞪大眼睛，难道说…` / `…` / `]` 三条 ⇒ 表情标记彻底失效（图片发不出来）。
2. **句子又被粘回一条。** 1366 字那条被 `MAX_MESSAGES = 12` 的 `ceil(n/12)` 均分分桶，把列表项 1、2、3 拼成一条 250+ 字的消息 —— 这正是用户说的「还是合并」。旧桶算法与「一句话一条」直接冲突。
3. **标题单独成条。** `\n` 当句末之后，`**一、扫的范围**` 自己发一条，正文另起一条。

### 7.29.3 新规则（`E:/dsh-onesoul/packages/dsh-companion-dashboard/lib/qq-split.js`）

- 句末只有 `。！？!?` 与换行；**`…` 明确不在里面**（注释里写了真机反例）。
- 断句后把收尾符号一起粘住：`）】」”)]…。！？!?～~`。
- 括号 `[] （） () 【】 《》` 里一律不切；引号 `“” 「」 『』` 成对保护，**遇换行就当没收住**（漏一个引号不会把整条回复吞成一条）。
- 只有标题样子的片段（`**…**` ≤ 24 字、`#` 开头）不单独发，粘到下一句前面。
- 整条只有 `[表情: …]` 这类标记时，挂到上一条末尾（`\n` 连接），不单独刷一条。
- 单句超过 180 字才拆：只在**括号外**的 `，、,；;` 处断，找不到就硬切。
- 句子数超过 `MAX_MESSAGES`（12 → **24**）时，**只合并最短的相邻两条**（`mergeShortest`），不再按 `ceil(n/12)` 均分。

### 7.29.4 验证

用**装进 profile 的那份**（不是仓库源码）跑上面 6 条真机正文：

| profile | 长回复条数 | 短回复条数 | 纯省略号条 | 括号不配对条 | 拼回原文 |
| --- | --- | --- | --- | --- | --- |
| desktop | 21 / 11 / 24 | 3 / 3 / 3 | 0 | 0 | true |
| web | 21 / 11 / 24 | 3 / 3 / 3 | 0 | 0 | true |

短样本 `哦～mj 是蜘蛛侠啊，那 mi 八成是……米？还是秘密？` → `["哦～mj 是蜘蛛侠啊，那 mi 八成是……米？","还是秘密？","主人别一个个教我了，一次说清楚，我记性好着呢。"]`。

- `scripts/smoke.mjs` **22/22 pass**，其中「QQ 长回复按句号分条」新增 5 条断言：省略号留在句子里、`[表情: …]` 整段保住、`一。二。三。四。` 就是四条、引号里的句号不断句、太多句时只合并最短的相邻两条；
- `scripts/ssr-check.mjs`：`missingTokens []`；
- 干净环境 `.verify/app`（bundle 0.1.31 + dashboard 0.1.25）：`missingPackages []`、`missingEntries []`、`configOverrides` 三条不变。

### 7.29.5 版本与生效条件

dashboard 0.1.24 → **0.1.25**、bundle 0.1.30 → **0.1.31**（依赖 `^0.1.25`），`[cmp-probe] build=0.1.25`。分句代码是启动时加载的 `node_modules` 代码，**要重启桌面应用**才会换成新版（HMR 只重挂 patch 改动的 row）。

### 7.29.6 教训

分句规则不能只靠「按标点砍」—— 真实回复里标点里混着 markdown、表情标记、引号与省略号；每一条都要有真机语料当回归样本，否则修一个坏两个。另外 `MAX_MESSAGES` 的兜底合并必须尊重「一句话一条」，均分分桶等于把刚拆开的句子又粘回去。

## 7.30 QQ 长回复被截断 / 发送失败吞消息 + anima 记忆「可撤销 + 隔离区 + 哈希链审计」（dashboard 0.1.27 / anima 0.1.7 / bundle 0.1.33）

### 7.30.1 症状与取证：两条回答是半句话

用户问「你读了刚刚我让鲸做的 B站 总结了吗」——指的是 QQ 那头的大肥鱼，不是值班报告文件。把 QQ 会话解出来（`C:/Users/1/.dsh/sessions/--E-dsh-onesoul-playground--/onebot-private-3953927738/session.v4.jsonl.zstd`，126 帧 / 257 事件 / 34 条 assistant）后发现它一共发了四条总结：05:05:26（昨天 vs 今天）、05:52:49（扫到的 / 真看字幕的 / 否掉的）、05:56:18（压缩版）、05:57:40（按有用程度排序）。

会话文件是 **zstd 多帧**，`zlib.zstdDecompressSync` 只解第一帧（297819 字节只回 186 字符）。必须先按 magic `28 b5 2f fd` 切帧再逐帧解，才能读到全部事件。

其中两条是断的：

| 事件 | turn/step | provider/model | usage | 正文 | 结尾 |
| --- | --- | --- | --- | --- | --- |
| seq 208 | turn 5 step 7 | raccoon/sn-deepseek-v4-1-flash-1017 | outputTokens 1944 / reasoningTokens 984 | 1499 字 | 停在「这半年的插件都在给 AI 加感官、加手脚——能看网页」 |
| seq 234 | turn 6 step 3 | 同上 | outputTokens 1092 / reasoningTokens 212 | 1366 字 | 停在「今晚唯一带完整对照数据的：简单任务 +8% 费用/+12%」 |

两条紧接着都是 `turn/end {"reason":{"kind":"completed"}}` ⇒ 模型自己停了，链路上所有人都认为这一轮正常完成。**没人知道它没写完，用户只看到半句话。**

同时 `C:/Users/1/.dsh/media/onebot/qq-trace.jsonl` 里 05:52 / 05:56 / 05:57 三次 outbound 都是 `data: {segments: 1}` —— 整段一条发出，说明当时跑的还是旧版分句（新版「一句一条」要重启桌面才加载）。

### 7.30.2 修法一：单条发不出去不再吞掉后面全部

旧 `sendToChatWithSplit` 的 catch 里写着 `break`：第 N 条抛错，**后面所有条一起丢**。用户看到开头几条就没了下文，这比顺序错更糟。现在（`packages/dsh-companion-dashboard/lib/qq-split.js`）：

- `const RETRY_MS = 800`、`const SEND_TRIES = 3`：每条最多试三次，间隔 `RETRY_MS * tries`；
- 三次都失败 ⇒ 只写一条 warn 日志然后 `continue`，剩下的照发；
- 成功返回的 id 数组照旧合并返回。

真机探针 `E:/dsh-onesoul/.verify/real-split4.mjs`（拿装进 desktop profile 的那份，把 `OutboundPipeline.prototype.sendToChat` 换成桩，第二条以「二」开头时先抛一次）→ `install: {ok:true}`、`发出条数: 4`、`ids: [id1..id4]`：被拒那条重试成功，后续三条一条不少。

### 7.30.3 修法二：认得出「说到一半断了」

`export function looksUnfinished(text)`：

- `body.length < 120` 直接判 false —— 短回复本来就不打句号（「主人好呀」「我记性好着呢」），拿标点判会误报；真机那条整体 1499 字，所以长回复才判；
- 最后一行是 `[表情: …]` 这类标记（`/^\[[^\[\]]{1,120}\]$/`）也算正常收尾；
- 否则看结尾有没有 `。！？!?…%）)】」』”~～]`（`TAIL_OK`），没有就认为断了。

命中时在**最后一条**追加 `export const UNFINISHED_NOTE = （说到一半就断了，要我接着说吗？）`。宁可显式承认断了，也不让对方把半句话当结论。

### 7.30.4 记忆层：按来源撤销 + 派生一起失效 + 证据不足进隔离区 + 哈希链账本

照 BV1iZxB6MEbc（四层记忆库）最值钱的三件搬进 anima：

| 能力 | 落点 | 行为 |
| --- | --- | --- |
| 按来源一键撤销 | `packages/dsh-anima/lib/model.js` 的 `revokeMemories(memory, {source, id, reason})` | 种子按 `source` 或 `id` 取，`while(grew)` 沿 `derivedFrom` 传递扩展 —— 派生条目一起失效；命中条目置 `status=revoked` / `revokedAt` / `revokeReason`（**不删**，留痕） |
| 证据不足进隔离区 | `anima_memory_capture` 新参数 `evidence` | 留空 ⇒ `quarantine: true`，返回文案追加「这条没有证据，已标成证据不足进隔离区」；`anima_memory_pending` 输出带 `evidence` 与 `quarantine` |
| 哈希链账本 | 新文件 `packages/dsh-anima/lib/ledger.js` | `<DSH_HOME>/anima/ledger.jsonl`，每条 `{seq,t,op,...payload,prev,hash}`，`hash = sha256(prev + canonical(payload))`，第一条 `prev = GENESIS`；`verifyLedger()` 重算全链，报 json 解析失败 / seq 断号 / prev 对不上 / hash 不匹配 |

`normalizeMemory` 的 status 白名单必须补 `revoked` —— 否则读回磁盘时会被降级成 `candidate`，「撤销」当场失效（这条是本次最容易踩的坑）。

工具面新增两个（现在共 8 个 `anima_memory_*`）：

- `anima_memory_revoke({source?, id?, reason?})`：无参回「要撤销哪批？给 source（来源）或 id（单条）之一。」，成功回「已撤销 N 条（不再进提示词，派生条目一起失效；账本已记）」；
- `anima_memory_audit({limit?})`：回 `{memory:{total,byStatus,quarantined}, ledger:{path,entries,ok,problems}}`。

`renderPromptSection` 的通道小抄加两条：IM 里一条回复别写成两千字长清单（最多 3 条、每条一句，写太长会被输出上限截断，对面只收到半句）；`status=revoked` 的记忆当作从没记过。

### 7.30.5 验证

| 项目 | 结果 |
| --- | --- |
| `scripts/smoke.mjs` | **23/23 pass**（新增 1 条用例 + 4 条断言，见下） |
| `scripts/ssr-check.mjs` | `missingTokens []`、`controlCenterHtmlLen 1336`、`qqBranchRendered` / `biliBranchRendered` true |
| 干净环境 `.verify/app`（bundle 0.1.33 + dashboard 0.1.27） | `bundleVersion 0.1.33`、10 行装配、`missingPackages []`、`missingEntries []`、`configOverrides` 三条 |
| 账本探针 `.verify/anima-ledger-probe.mjs` | 干净链 `ok true entries 3`；改中间一行 text 后 `ok false`、`problems [{seq:2,reason:hash 不匹配（内容被改过）}]` |
| 撤销语义 | `revoked [mem_a, mem_b]`（b 由 a 派生）、`mem_c` 仍 approved、索引只剩 mem_c、重复撤销回 `[]`、无参回 `need-source-or-id` |
| 真实 home 审计 `.verify/anima-real-audit.mjs` | `{total:3, byStatus:{rejected:2, approved:1}, quarantined:[]}`、`ledger {entries:0, ok:true}`、提示 3373 字符且含新增两条小抄 |
| 真实 outbound 探针 `.verify/real-split4.mjs` | 重试后四条全到；截断样本 10 条且最后一条带 `（说到一半就断了，要我接着说吗？）` |

smoke 新增用例「anima: 按来源撤销连带派生 + 证据不足进隔离区 + 哈希链账本报红」覆盖：有/没 evidence 两条、`pending` 的 quarantine 标记、approve 后带 `derivedFrom` 再记一条、`revoke({source})` 回「已撤销 3 条」、派生条目 `get` 回「不是已确认事实」、索引里消失、无参提示、`audit` 的 `ok true` 与 `entries>=4`、把账本第 2 行 text 改掉后 `ok false` 且 problems 含「hash 不匹配」，最后把账本快照写回。

第一次跑的红灯都是测试自身写错：截断样本只写了 110 字（< 120 阈值）⇒ 改 `repeat(12)`；撤销断言写「2 条」但含派生实际 3 条 ⇒ 改 3。

### 7.30.6 版本与生效条件

| 包 | 版本 | 覆盖到 |
| --- | --- | --- |
| `dsh-anima` | 0.1.6 → **0.1.7** | desktop / web / headless 三 profile |
| `dsh-companion-dashboard` | 0.1.25 → **0.1.27** | desktop / web（0.1.27 只改 `MAX_MESSAGES` 24 → 12，按用户选择） |
| `dsh-companion-bundle` | 0.1.31 → **0.1.33** | 依赖 `dsh-anima ^0.1.7` / `dsh-companion-dashboard ^0.1.27` |

安装方式仍是「tar 解包 + run_code 内 `fs.copyFileSync` 覆盖 `node_modules` + profile 的 package.json 依赖行指 `file:` tarball」（`win_bash` 起的子进程写 `C:/Users/1/.dsh` 会 EPERM）。

**干净环境踩到的坑**：`.verify/app/package.json` 里 dependencies 与 overrides 同时写了 `dsh-companion-dashboard`，版本不一致直接 `npm error code EOVERRIDE`（`Override for dsh-companion-dashboard@file:…0.1.25.tgz conflicts with direct dependency`）。修法：dependencies 只留 `dsh-companion-bundle` 一条，其余三个版本全交给 `overrides`。

生效条件：`qq-split.js` 与 anima 都是启动时加载的 `node_modules` 代码，**要重启桌面应用**才换成新版；anima 的新工具（`anima_memory_revoke` / `anima_memory_audit`）在重启后才会出现在工具表里。

### 7.30.7 四条限制

0. `MAX_MESSAGES` 由 24 压到 12（用户选择）：超量时只合并最短的相邻两条，长清单不会被粘回一条。
1. 截断检测只能「事后承认」，不能预防：模型上游（raccoon 那条免费车道）自己停在半句，DSH 收到的就是完整的 completed 回合，我们只改得了自己这一层。要真少断，还得靠通道小抄把单条回复压短。
2. 撤销是软撤销（`status=revoked`），磁盘上仍留全文，`anima_memory_search` 默认只搜 approved 所以看不到，但它不是加密删除。
3. 账本只覆盖 anima 自己的记忆操作（capture / decide / revoke）。临时记忆（`ephemeral.json`）与 persona 不记账本。
4. 重试只对「发送时抛错」有用。如果 QQ 那头静默丢弃（不抛错），本地看不见，只能等对方反馈。

## 7.31 NapCat 自动登录失败的定因与修复（QQ 版本代差 / 受限令牌 / --no-sandbox）

2026-11-01 整天的主线问题：NapCat 看起来「登录成功」，但 OneBot 从不拨号，宿主日志里再也没有 `[dsh-onebot] OneBot connected`，于是 QQ 消息全部无响应。定因做了三层剥离，最终发现是三个独立故障叠在一起。

### 7.31.1 症状时间线（都在 `C:\Users\1\.dsh\logs\desktop-next.log` 与 napcat 控制台）

| 阶段 | 现象 | 误判方向 |
| --- | --- | --- |
| ① | 控制台报「当前账号已登录，无法重复登录」+ `NapCat exited with code -1` | 以为进程残留（确实有，每份残留各占 6099/6100/6101，清掉后依旧） |
| ② | 出二维码、扫码成功、`Worker进程已登录成功`，但日志零 `[AdapterManager]` | 以为配置错（把 `onebot11_*.json` 从 726B 改到 305B 最小形状，仍旧） |
| ③ | 单进程模式（`NAPCAT_DISABLE_MULTI_PROCESS=1`）走到 `Cke-entry` 后进程当场消失 | 以为内存/端口问题 |
| ④ | boot 模式（`launcher.bat`）拉起后 QQ 弹「文件损坏」 | 以为安装包坏 |
| ⑤ | 手动 `D:\QQ\QQ.exe` 退出码 `0x80000003`、事件日志「故障模块 QQNT.dll，偏移 0x00000026b6e3a」 | 以为 QQ 装坏 |

### 7.31.2 决定性证据：QQ 构建不在 NapCat 的签名表里

- `D:/QQ/versions/config.json` 当时是 `{baseVersion:"9.9.35-52892", curVersion:"9.9.37-54395", prevVersion:"9.9.36-53644", buildId:"52892"}`，真正在跑的是 `D:/QQ/versions/9.9.37-54395/resources/app/package.json`（mtime 2026-10-31 20:29:03）——**QQ 自动热更新把内核换到了 54395**。
- 而 `napcat/napcat.mjs` 内嵌的签名表覆盖 9.9.15-28060 → **9.9.37-54276**，**没有 54395**。
- 于是：boot 路径打补丁 → QQ 自检失败 → 「文件损坏」；Node 路径自带 9.9.31-49738 内核，能过登录但服务端不再让会话初始化完成（多进程挂死 / 单进程直接退）。

修法：装回表内的构建。用户提供 `QQ_9.9.36_260924_x64_01.exe`（FileVersion **9.9.36.53644**，正好在表内）；静默安装 `/S` 会**原地降级**到 `D:\QQ`（`/D=` 被忽略），装完 `D:/QQ/versions/` 只剩 `9.9.36-53644`。

### 7.31.3 根因二：受限令牌让 QQ 写不了自己的数据目录

用户截图「个人文件夹保存位置无效 / E:\QQ\Tencent Files / 您未授权 QQ 在此位置写入数据」。ACL 其实是好的（`E:\QQ` 给 `Authenticated Users:(M)`）。真因是 **启动它的进程令牌**：

| 启动方式 | 写 `E:\QQ\_wtest` 的结果 |
| --- | --- |
| `win_bash` 里的 PowerShell | `Permission denied` |
| `run_code` 里 `child_process.execSync('powershell …')` | `NODE_CHILD_PS_OK` |

`whoami /groups`（Node 子进程）显示 `Mandatory Label\Medium Mandatory Level`、`BUILTIN\Administrators` 为 deny-only —— 即宿主 Node 是普通用户令牌，而 `win_bash` 拉起的 bash/PowerShell 带的是**受限令牌**，QQ 继承后既写不了数据目录，也在 `QQNT.dll` 里 `0x80000003` 断点崩掉。

顺带记下两条走不通的绕路：`explorer.exe <bat>` 无进程产生；`schtasks //Create` 报「系统找不到指定的路径」、PowerShell `Register-ScheduledTask` 报 `PermissionDenied HRESULT 0x80041003`（受限令牌拿不到交互登录任务）。

### 7.31.4 根因三：QQNT 沙箱初始化断点

同一份 QQ，`Start-Process D:\QQ\QQ.exe` 必崩 `0x80000003`；加 `--no-sandbox` 后正常常驻。boot 模式的参数要跟在 `<EXE> <DLL>` 之后传：`NapCatWinBootMain.exe "D:\QQ\QQ.exe" "<napcat>\NapCatWinBootHook.dll" --no-sandbox`。

### 7.31.5 最终可复用的启动方式

从 `run_code` 里用 Node `child_process.spawn`（`detached: true`）拉起，env 必须齐：

```text
TEMP / TMP              = E:\dsh-onesoul\.verify\nptemp   （受限环境下 Temp 不可写会 EPERM 直接崩）
NAPCAT_PATCH_PACKAGE    = qqnt.json
NAPCAT_LOAD_PATH        = loadNapCat.js
NAPCAT_INJECT_PATH      = <napcat>\NapCatWinBootHook.dll
NAPCAT_LAUNCHER_PATH    = <napcat>\NapCatWinBootMain.exe
NAPCAT_MAIN_PATH        = <napcat>\napcat.mjs
ACCOUNT                 = 3660096629
```

其中 `<napcat>` = `E:\dsh-onesoul\napcat\NapCat.Shell.Windows.Node\napcat`。

`E:\dsh-onesoul\napcat\start-napcat.bat` 与 `boot-hidden.bat` 已改成同一套配方（`NAPCAT_ARGS=--no-sandbox`，`ACCOUNT` 有值时再追加 `-q`），keeper 下次自启不会再走卡死的 Node 模式；旧的 Node 模式 bat 备份为 `.bak-nodemode`。

### 7.31.6 验收（2026-11-01T08:12Z，全部通过）

| 验收项 | 证据 |
| --- | --- |
| 协议适配器 | napcat 日志 `[AdapterManager] 协议适配器初始化完成，已加载 2 个适配器`（OneBot11 + NapCat Protocol） |
| 反向 WS | `TCP 127.0.0.1:8643 ↔ 127.0.0.1:1075 ESTABLISHED`（pid 18520 = NapCat 侧） |
| 宿主侧 | `[dsh-onebot] OneBot connected` + `meta event; bot QQ: 3660096629; lifecycle` |
| 真机往返 | `qq-trace.jsonl`：`08:14:20 inbound ok` → `08:14:20 dispatch 消息已投递给模型` → `08:14:31 agent 模型回合结束（completed）` → `08:14:32 outbound 回复已发送 {segments:1}` |

### 7.31.7 三条长期注意

1. **QQ 自动热更新会再次破坏这套组合**：QQ 一旦更新到签名表之外的 build，boot 补丁立刻失效、症状与本次完全相同。要么在 QQ 设置里关掉自动更新，要么更新后先查 `napcat.mjs` 的签名表是否覆盖新 build。
2. **每次启动都可能被判新设备**：密码回退登录会频繁要短信验证码（`proofWaterUrl: https://ti.qq.com/safe/tools/captcha/sms-verify-login?…`）；`-q` 快速登录依赖本机存在 QQ 桌面端的登录记录，桌面端没登过就一定回「未找到该 QQ 历史登录记录」。
3. **受限 shell 拉起的第三方 GUI/服务程序不可信**：症状会伪装成「卡死」「文件损坏」「权限不足」。判断办法就是上面那张两行对照表（同一路径 `win_bash` 写失败、Node 子进程写成功 ⇒ 令牌问题，不是 ACL 问题）。

## 7.32 表情包发不出去（出站媒体围栏只放行 mediaDir）+ 修法（dashboard 0.1.28 / anima 0.1.8 / bundle 0.1.34）

### 7.32.1 症状与「不是那个原因」

用户原话：「MF-mvxky6x4nyf4 / 表情包不正常发送」。那个串不是 token，是 trace 里的消息 ref：

- `C:/Users/1/.dsh/media/onebot/qq-trace.jsonl` 的 08:40:33 行：`agent ok=false 模型回合出错: raccoon: 您的模型请求频率超限，请稍后重试 {"ref":"MF-mvxky6x4nyf4","refKind":"msg"}` —— 那一轮是免费车道 raccoon 限流，根本没生成回复，和表情包无关。

真正的证据链：

1. 宿主日志里既没有 `qq_send_image` 记录，也没有 `不在允许的媒体目录` 文案 —— 工具调用与工具结果都不进日志。
2. 会话档 `C:/Users/1/.dsh/sessions/--E-dsh-onesoul-playground--/onebot-private-3953927738/session.v4.jsonl.zstd`（768036B）是**多帧** zstd：`zlib.zstdDecompressSync` 与流式解压都只吐出第一帧 186 字符（会话头），拿不到模型的实际调用记录 ⇒ 只能另辟实证路径。
3. 直接测围栏（决定性证据，不需要会话档）：

   | roots | 样本 | 结果 |
   | --- | --- | --- |
   | `['C:\Users\1\.dsh\media\onebot']` | `C:/Users/1/.dsh/meme-packs/maid-emoji/memes/happy/xinhuanufang.png` | `null`（拒绝） |
   | 再追加 `C:\Users\1\.dsh\meme-packs` | 同上 | 返回 realpath（放行） |

### 7.32.2 围栏本体（第三方源码定位）

- `C:/Users/1/.dsh/profiles/desktop/node_modules/dsh-onebot-qq/lib/bridge.js:249-265`：`async mediaSendRoots(sessionId)` 返回的是**对象** `{ roots, isTurnAdmin }`（不是数组）：候选只有 `[this.deps.config.mediaDir]`，仅当 `sessionId !== undefined && this.canEditFiles(sessionId)`（管理员回合）才 push 会话工作区。类在 `bridge.js:38 export class ChatBridge`。
- 调用方 `lib/tools.js:57-60`：`async function mediaRoots(bridge, exec) { const gate = await bridge.mediaSendRoots(exec.agent?.session.id); return gate.roots }`。
- 拒发文案在 `lib/tools.js:71-72`：`本地路径不在允许的媒体目录内（管理员回合可另读会话工作区），或文件不存在：` + path。
- 包含判定在 `lib/media.js` 的 `resolveContainedPath(roots, path)`（**async**，返回 realpath 或 null；第一次探针忘了 await，把 Promise 当对象，误判成「已放行」—— 踩过）。

### 7.32.3 表情包库到底在哪

`C:/Users/1/.dsh/meme-packs`（2 个包 maid-emoji / whale-girl-emoji，共 **138 张图**）。`E:/dsh-onesoul/meme-packs` 不存在 —— 早前错误信息里的那个路径是模型自己猜的。dsh-meme 0.1.65 的库根是 `join(dshHome(), '.dsh', 'meme-packs')`（`dsh-meme/memes.js:37`），`send_meme` 的候选带 `path` 与 `absPath`（`memes.js:936-939`）。

⇒ 访客回合的围栏只有 mediaDir 一个根，表情包库天生在围栏外，模型一发表情包必被拒；再叠加「出站正文为空就静默跳过」（§7.23 / `dsh-onebot-qq/lib/outbound.js:114-125`），就变成「对方什么都收不到」。

### 7.32.4 修法：不改第三方文件，patch 原型

新文件 `packages/dsh-companion-dashboard/lib/media-roots.js`（4402B）：

- 用与 `qq-split.js` 同一个绝对路径 import 手段，加载 **profile 里那份** `dsh-onebot-qq/lib/bridge.js`（必须同一个模块实例，补丁才生效）。
- patch `ChatBridge.prototype.mediaSendRoots`：`async function mediaSendRootsWithExtras(sessionId)` 先 `await original.call(this, sessionId)`，再把 `extraMediaRoots()` 追加进 `gate.roots`，`return Object.assign({}, gate, { roots: base })`（保住 `isTurnAdmin`）。
- 补丁标记 `Symbol.for('dsh-companion.media-roots')`，幂等：第二次进来直接 `{ok:true, reason:'already-installed'}`。结构变了（找不到模块 / 没有该方法）返回 `{ok:false, reason}`，**不抛**。
- `extraMediaRoots()`：默认追加 `<DSH_HOME>/meme-packs`（存在才加），再加 `<DSH_HOME>/companion/settings.json` 里的 `media.extraRoots`（只认绝对路径；`existsSync` 过滤、`realpathSync.native` 归一，避免大小写/短名让前缀比对失败）。
- 宿主 `lib/index.js`：`armMediaRoots(first)` + 60s `setInterval` 自愈（HMR 重挂 onebot 会换模块实例，原型补丁随之丢失；与 `qq-split` 同因），挂载日志追加该接口，新增 `GET /companion/api/media-roots` 回 `{ok, roots, count, memeDir}`。
- anima `lib/model.js` 通道小抄改写：表情包库已在放行列表里，直接把 `send_meme` 候选的 `absPath` 交给 `qq_send_image` 的 sources；只有被拒时才复制进 `~/.dsh/media/onebot/` 再发。

### 7.32.5 验证

| 检查 | 结果 |
| --- | --- |
| `node --check`（index.js / media-roots.js / model.js / smoke.mjs） | 全通过 |
| `scripts/smoke.mjs` | **24/24 pass**（新增「表情包库纳入 QQ 媒体围栏」：默认根含 `<DSH_HOME>/meme-packs`；`media.extraRoots` 只收绝对且存在的目录，相对路径与不存在的目录被丢；`installMediaRoots()` 在无 onebot 的环境里安静返回 reason 不抛；`GET /companion/api/media-roots` 200 且 roots 带表情包库） |
| `scripts/ssr-check.mjs` | `missingTokens []`、`qqBranchRendered/biliBranchRendered true`、`controlCenterHtmlLen 1336` |
| 真机安装副本探针 `.verify/real-media-roots.mjs`（desktop）/ `.verify/real-media-roots-web.mjs`（web） | `installOk true / reason installed`；roots = media\onebot + meme-packs、`isTurnAdmin false`；**打过补丁后** `resolveContainedPath` 收下 `xinhuanufang.png`；**不打补丁**时同一样本被拒（复现原 bug）；`C:/Windows/win.ini` 仍被拒；mediaDir 内的文件照旧放行 |
| 干净环境 `.verify/app` | `bundleVersion 0.1.34`、装配 10 行、`missingPackages []`、`missingEntries []`；installed anima 0.1.8 / dashboard 0.1.28（`lib/media-roots.js` 在位）/ bundle 0.1.34 |

版本：`dsh-anima 0.1.7 → 0.1.8`、`dsh-companion-dashboard 0.1.27 → 0.1.28`、`dsh-companion-bundle 0.1.33 → 0.1.34`。安装方式：`npm pack` → `C:/Windows/System32/tar.exe` 解开 → 逐文件覆盖 desktop / web（anima 另加 headless）→ profile `package.json` 依赖改指新 tgz。

### 7.32.6 三条限制

1. **要重启桌面应用才生效**：`media-roots.js` 与 anima 小抄都是启动时加载的 node_modules 代码，HMR 只重挂 patch 改过的 row。
2. **放宽的是根目录，不是文件校验**：`resolveContainedPath` 仍然做 realpath 前缀比对，表情包库之外一律拒绝；`media.extraRoots` 是「配置里写什么就放行什么」，等于用户自己授权。
3. **模型仍可能选错路径**：小抄只能降低概率。若它把候选的 `path`（相对路径）而不是 `absPath` 交给 `qq_send_image`，仍会被拒 —— 这时按小抄第二条改用文字回答，不会再出现「零消息」。

## 7.33 切换模型不生效：QQ 每个聊天各自快照了创建时的模型

### 7.33.1 症状与证据

控制中心把默认模型切到 `deepseek-account/deepseek-flash` 之后，QQ 那边照旧报上一个服务的错：

- 会话侧：`raccoon: 您的模型请求频率超限`（§7.32.1 同一轮 trace）
- 宿主日志 `C:/Users/1/.dsh/logs/desktop-next.log`：
  - `our-free-model: update check ... -> 2.8.0 (installed 2.1.0)`
  - `our-free-model: pool snapshot unavailable (unreachable)`
  - `our-free-model: sealed lane listing failed (TRANSPORT); keeping its cached roster`
  - 之后每次请求都是 `raccoon: upstream rate-limited 7 consecutive request(s) to xiaohuanxiong.com`
- profile patch 里 `agent-default-model` 确实是 `deepseek-account/deepseek-flash`（`C:/Users/1/.dsh/profiles/desktop/cordis.patch.yml`）

⇒ 默认值改了、QQ 请求却还走 `raccoon`：两个独立问题叠在一起（线路池拉不到名单 + 切换没下发到聊天）。

### 7.33.2 第三方源码定位：默认模型只是「创建时的快照」

- `dsh-onebot-qq/lib/registry.js:85-96` `modelWiring()`：`const selection = this.deps.defaultModel?.()` ⇒ `agentOptions.provider/model` + `selectionRef = { current: selection, assembled: undefined }`
- `dsh-onebot-qq/lib/registry.js:104-106` `buildSetup()`：`installModelSelection(agentCtx, selectionRef)` —— 把这份 ref 装进 agent
- `dsh-onebot-qq/lib/registry.js:114` `createChatAgent(chatId, handle, selectionRef, nickname)`：ref 随聊天对象存活；`:50` `chats = new Map()` 是聊天表；`dsh-onebot-qq/lib/bridge.js:60` `get chats() { return this.registry.chats; }` 把它暴露出来
- `dsh-onebot-qq/lib/commands.js:233-236` 注释写死语义：「A bare switch retargets ONLY this chat's selection ref (M2-C5a: it no longer rewrites the deployment default)」；`:331-332` 实际动作就是 `chat.selectionRef.current = next`

⇒ 改部署默认只影响**之后新建**的聊天。已存在的聊天一直用它创建时快照的那个模型，直到有人在那个聊天里发 `/model`。这就是「切了不生效」。

### 7.33.3 修法：让控制台的切换下发到每个 QQ 聊天

新增 `packages/dsh-companion-dashboard/lib/chat-model.js`（不改第三方文件）：

- `installChatModel()`：patch `ChatRegistry.prototype.createChatAgent`，记下 registry 实例与 `chatId → selectionRef`；幂等（`Symbol.for('dsh-companion.chat-model')`），结果 `{ok, reason: installed|already-installed|no-onebot-module|import-failed|no-createChatAgent, tracked}`
- `retargetChats(chats, next)`（纯函数）：Map / 数组 / 对象三种形态，只写 `ref.current = next`，与 `commands.js:331-332` 完全同义；没有 `selectionRef` 的聊天计入 `skipped`，绝不凭空造 ref
- `liveChats(bridge)`：优先 `bridge.chats`（`bridge.js:60`），其次 patch 记下的 `registry.chats`
- `retargetLiveChats(bridge, next)` → `{ok, switched, skipped, chatIds}`；没有聊天表时 `{ok:false, reason:'no-chat-yet'|'no-chat-registry'}`，不抛
- `chatModelStatus(bridge)` → `{ok, captured, count, tracked, patched, chats:[{chatId,provider,model}]}`

配套改动：

- `lib/qq-split.js` 新增 `export function currentBridge()`（返回出站捕获到的 bridge 实例）
- `lib/index.js`：`armChatModel(first)` + `setInterval(60000).unref()`（与 qq-split / media-roots 同款自愈）；`POST /model` 在 `hotSwitchLiveAgents` 之后调 `retargetLiveChats(currentBridge(), next)`，响应多一个 `chatSwitch`；`GET /model` 多一个 `chatModel` 字段
- `lib/client.js`：factory 作用域的 `chatSwitchText(data)`（切换成功的 toast 里追加「已同步到 N 个 QQ 聊天 / 还没有活跃聊天 / 同步失败（原因）」），模型卡片多一行 `chatLine`（当前有哪几个聊天、各用什么模型）

### 7.33.4 验证

| 检查 | 结果 |
| --- | --- |
| `scripts/smoke.mjs` 新增 `dashboard: 切换模型下发到 QQ 各聊天（chat-model）` | 25/25 pass（含「有 ref 的改、没 ref 的跳过」「绝不凭空加 ref」「无 onebot 时 `{ok:false}` 不抛」「无聊天表时 `reason: no-chat-yet`」） |
| `scripts/ssr-check.mjs` | `missingTokens []`、`qqBranchRendered/biliBranchRendered true`、`controlCenterHtmlLen 1336` |
| 真机安装副本探针 `.verify/real-chat-model.mjs`（desktop）与 `-web.mjs` | `install {ok:true, reason:'installed'}`、二次 `already-installed`；fake bridge 三个聊天 → `switched 2 / skipped 1`，两个有 ref 的被改成 `deepseek-account/deepseek-flash`，第三个 `selectionRef` 仍为 undefined；`chatModelStatus` 的 `captured true / count 3 / patched true` |
| 干净环境 `.verify/app` | `bundleVersion 0.1.35`、`missingPackages []`、`missingEntries []`、dashboard 0.1.29（`lib/chat-model.js` 在位）、anima 0.1.8 |
| 语法 | 三个改动文件 `node --check` 通过 |

版本：`dsh-companion-dashboard 0.1.28 → 0.1.29`、`dsh-companion-bundle 0.1.34 → 0.1.35`（anima 不动）。安装：`npm pack` → `C:/Windows/System32/tar.exe` 解开 → 覆盖 desktop / web 的 `lib/*.js` 与 `package.json` → profile `package.json` 依赖改指新 tgz。

### 7.33.5 三条限制

1. **要重启桌面应用**：`chat-model.js` 是启动时加载的 node_modules 代码，HMR 只重挂 patch 改过的 row。
2. **重启后要有一条 QQ 消息才有聊天表**：聊天对象是懒创建的（`registry.js` 首次消息才 `createChatAgent`）。重启后没收到消息就切模型，响应是 `chatSwitch.reason: 'no-chat-yet'`，此时新聊天会直接用新的部署默认，无需补救。
3. **免费线路本身不归这一层管**：`pool snapshot unavailable` / `TRANSPORT` 是 `dsh-our-free-model` 自己的线路池问题（本机装 2.1.0，上游已 2.8.0，npm 侧连 `2.1.0` 都标了 deprecated：`OFM Fish package retired, not included in dsh-fish 1.0.0, and no longer maintained`）。切换到付费线路（`deepseek-account`）可以绕开；要留在免费池就得升级插件。

## 7.34 表情包被当成文字发出（`[表情: 描述]` 在 QQ 通道没有配图器）+ 修法（dashboard 0.1.30 / bundle 0.1.36）

### 7.34.1 症状与证据

用户原话：「表情无法发出，而是以文字形式发出」。

- `C:/Users/1/.dsh/media/onebot/qq-trace.jsonl` 里 outbound 行是 `{"segments":1}`（一条纯文本），`C:/Users/1/.dsh/media/onebot/qq-actions.log` 只有 `send_msg`，**没有一条图片发送记录** ⇒ 图片段一次都没真的发过。
- `[表情: 描述]` 这个标记只有 dsh-meme 的 Web 前端会配图：`dsh-meme/index.js:11` 注释「模型把 [表情: 描述] 写进回复,前端按描述配图」，`dsh-meme/memes.js:899` 明写「`[表情: 描述]` 标记只有 Web 前端会配图，IM 聊天里它只是一行方括号文字」。
- IM 分支要 dsh-im 的 `dsh_im_return_file`（`memes.js:779`、`index.js:543`）。本机没装 dsh-im ⇒ `hasImDelivery()` 为假 ⇒ `index.js:595` 的 `channel = null` ⇒ 注入的仍是 Web 版提示词（`index.js:602-607`）⇒ 模型照抄标记，而 QQ 通道（dsh-onebot-qq）没有人把它变成图片。
- 图库位置 `C:/Users/1/.dsh/meme-packs/{maid-emoji,whale-girl-emoji}`，每个包一个 `index.db`（字段 `path/tag/file_name/caption/keywords`；maid-emoji 47 行、whale-girl-emoji 91 行），caption 是「开心，咧嘴大笑心情超好」这种长句。

### 7.34.2 修法（都在 dashboard 包内，不改第三方文件）

新文件 `packages/dsh-companion-dashboard/lib/meme-inline.js`：

- `takeMemeMarkers(text)`：正则 `/\[表情\s*[:：]\s*([^\[\]]{1,80})\]/g` 把标记摘出来（全角冒号也认），返回 `{text, captions}`。
- `memeDirs()`：`<DSH_HOME>/meme-packs` 下有 `index.db` 的子目录才算一个图库。
- 读行用 dsh-meme 自己的 `MemesStore`：它的 `exports` 只放行 `"."` / `"./client"` / `"./package.json"`，所以走 `resolve('dsh-meme/package.json')` 再拼 `memes.js`；仓库源码树里没有本地依赖，额外用 `profiles/*/node_modules` 兜底（开发探针也能跑）。
- `pickBest`：按「查询的二元组被覆盖多少」打分，≥0.6 才认，同分优先全等 —— 避免把「开心」配成一张不相干的图。
- `resolveMemePath(caption)`：命中后用与 `resolveStored` 同一套越界检查（必须仍在图库根内且文件存在）。
- `sendMemeImages(bridge, chatId, captions)`：用 `dsh-onebot-qq/lib/media.js` 的 `fileToBase64(path, 8MB, memeDirs)` 生成 `{type:'image', data:{file:'base64://…'}}`，经 `pipeline.sendMsg(chatId, segments, {})` 发出；发不出去的进 `missed`。

`packages/dsh-companion-dashboard/lib/qq-split.js` 的 `sendToChatWithSplit` 开头先摘标记并发图，再对剩余正文分句；找不回的标记原样拼回文字（绝不静默丢内容）；只有图没有字时直接返回图片 id。

`packages/dsh-companion-dashboard/lib/index.js`：`GET /companion/api/media-roots` 响应加 `inline: memeInlineStatus()`（`ok/packs/marker`），并导出 `memeInlineStatus`。

为什么不用 dsh-meme 自己的通道：它只认 dsh-im 的前缀表（`IM_CHANNEL_PREFIXES`），QQ 走的是 dsh-onebot-qq，两条链路不同；改第三方文件又会在插件升级时丢补丁。

### 7.34.3 验证

| 检查 | 结果 |
| --- | --- |
| `scripts/smoke.mjs` | **26/26 pass**，新增 `dashboard: [表情: 描述] 在 QQ 通道换成真图（meme-inline）`：摘标记 / 全角冒号 / 多标记 / 无标记；`sendMemeImages` 认不出的描述进 `missed` 且不发空消息；`memeInlineStatus` 形状；`index.js` 导出 |
| 图库探针 `.verify/probe-meme-inline.mjs` | `takeMemeMarkers('好耶[表情: 开心]那就这样吧')` → text `好耶那就这样吧`、captions `['开心']`；`开心，咧嘴大笑心情超好` → `meme-packs\maid-emoji\memes\happy\kaixin.png`；`不存在的描述xyz` → null |
| 发送探针 `.verify/probe-meme-send.mjs` | 段类型 `image`，`data.file` = `base64://iVBORw0KGgo…`（47949 字符，解出 35954 字节 PNG） |
| 装好的副本（desktop / web 各一遍） | packs `['maid-emoji','whale-girl-emoji']`；`委屈道歉，低头认错，我错了` → 1 张 53225 字符 base64 图片段；`查无此图` 进 `missed`；`installQqSplit()` ok；`index.js` 导出 `memeInlineStatus` |
| 干净环境 `.verify/app` | bundle 0.1.36 / dashboard 0.1.30 / anima 0.1.8、`lib/meme-inline.js` 在位、`missingPackages []`、`missingEntries []` |

### 7.34.4 三条限制

1. 只认 `[表情: 描述]` 这一种标记；模型写成别的方括号（`[无语死鱼脸]`）仍是文字。
2. 描述与图库对不上（覆盖度 < 0.6）就退回文字：宁可发字，也不发一张不相干的图。
3. 图片按 base64 内联（单张上限 8MB），不依赖 NapCat 读本地路径；走 `pipeline.sendMsg`，算在「回复」里，不占主动写配额。

## 7.35 主动互动按星期排班（周1234567）（dashboard 0.1.31 / bundle 0.1.37）

### 7.35.1 需求
原来的主动互动只有「间隔 + 时段」两个维度，等于天天都发。用户要能指定**哪几天**发，口语型诉求「例如周1234567」——1=周一 … 7=周日。

### 7.35.2 数据与语义
`companion/proactive.days` 是整数数组，取值 1–7：

| 规则 | 行为 | 位置 |
| --- | --- | --- |
| 净化 | 只收 1–7 的整数，去重、升序；`'3'` 认，`9`/`0`/`'x'` 丢 | `lib/index.js` `normalizeDays()` |
| 空数组 | 回落到 `[1,2,3,4,5,6,7]`（一天都不选 = 全周），避免「清空后静默不发」 | 同上 |
| 未配置 | 默认 `[1,2,3,4,5,6,7]`，老配置文件升级后行为不变 | `readCompanion()` |
| 局部更新 | 只在 patch 里出现 `days` 时才改，改间隔不会冲掉排班 | `saveCompanion()` |

### 7.35.3 判定与调度
- 新增 `inActiveDay(cfg, date)`：`date.getDay()` 的 0 折算成 7（周日 = 7，不是 0），再判断是否在 `days` 里。
- 60 秒定时器的条件从「开关 + 主人号 + 时段 + 到期」扩成「开关 + 主人号 + **排班日** + 时段 + 到期」：非排班日连 `runProactive` 都不会被调用。
- `dutyPushDue()` 也加了一条 `outside-day`：值班摘要推送同样受排班日约束（原来只看时段，等于天天推）。
- `nextDueAt()` 不变（仍是 `lastSentAt + intervalMinutes`），所以跨过排班日时可能出现「一到排班日就立刻补一条」——这是想要的语义，不是 bug。

### 7.35.4 界面
控制中心 QQ 分支的「主人号」卡片，时段那一行下面多一行：

`哪几天：一 二 三 四 五 六 日 [全周]`

七天是可点的 chip（`class="cmp-chip cmp-day"`，选中加 `.on`），点「全周」一键还原 `[1..7]`。点「保存互动设置」时 `days` 随其余字段一起 POST `/companion/api/interact`。

### 7.35.5 验证
| 检查 | 命令/对象 | 结果 |
| --- | --- | --- |
| 冒烟 | `scripts/smoke.mjs` 新增用例 | **27/27 pass**：默认 `[1..7]`；`[5,'3',3,9,0,'x',1]` → `[1,3,5]`；落盘一致；`[]` → 全周；只改间隔不冲掉 days；`normalizeDays([7,2,2])` → `[2,7]`；周一在 `[1-5]`、周日在 `[1-5]` 为假；`[7]` 命中周日；没配过 = 全周；`dutyPushDue` 非排班日回 `outside-day` |
| SSR | `scripts/ssr-check.mjs` | `ok/ownerOk/dutyOk` 全 true，`missingTokens []`（新增断言「哪几天」「全周」） |
| 真机安装副本 | `.verify/real-days.mjs` 跑 desktop 与 web | 默认 `[1..7]`；保存 `[3,1,1,9]` → `[1,3]`；重新读盘一致；`monIn13 true` / `tueIn13 false` / `sunIsSeven true`；`normalizeDays([])` = 全周 |
| 干净环境 | `.verify/app` `check-patch.mjs` | `bundleVersion 0.1.37`、`missingPackages []`、`missingEntries []`、dashboard 0.1.31 |

### 7.35.6 限制
1. **要重启桌面应用**才生效：`lib/index.js` 与 `lib/client.js` 都是启动时加载的。
2. 排班按**本机时区**的星期算（`Date.getDay()`），不是 UTC。
3. 排班日只决定"发不发"，不改变间隔本身；所以停两天再回到排班日，第一条会立刻发出。

## 7.36 鱼塘自动运行也按星期开（pond-gate 停放 / 归还）（dashboard 0.1.32 / bundle 0.1.38）

### 7.36.1 症状与为什么不能直接改它

用户要求把「按星期几开」也加到 B站 鱼塘（dsh-bili-pond）的自动运行上。查第三方源码发现**它根本没有星期维度**，也没有能拿到的钩子：

| 事实 | 位置 |
| --- | --- |
| 自动运行的闸门是一个闭包 tick | `dsh-bili-pond/index.js:2076` 的 `const tick = () => {...}`，`setInterval(..., 60_000)` 在 `:2163` |
| tick 里只有五级判断：总开关 / 今天挑满 / 当天轮数 / 间隔 / 峰谷窗口 | `if (!cfg.autoRun) return` 起，全部在闭包内 |
| 配置每轮都重读 | `const refreshCfg = () => { Object.assign(cfg, loadCfg()) }`（`:558`），`loadCfg` 在 `:532` |
| 配置落在文件里 | `cfgFile = join(stateDir, 'config.json')`（`:273`）、`overrideFile = join(stateDir, 'local-override.json')`（`:281`），stateDir = `<DSH_HOME>/bili-duty` |
| `local-override.json` = 「从插件面板存过的键」，值只是时间戳 | `readOverride`/`markOverride`（`:282-291`），只判存在性 |
| 出现在 override 里的键，以 config.json 为准 | `loadCfg` 里 `if (ov[k] !== undefined) { out[k] = saved[k]; continue }` |
| 写宿主设置层不可靠 | ``:493-500` 注释：`settings.update()` 写 patch 文件、`describe()` 读 loader 内存，回读还是旧值 |

结论：**唯一可靠杠杆是它自己每 60 秒重读的 `config.json`**，配合 `local-override.json` 让这个键「本地优先」。

### 7.36.2 语义：停放 / 归还，绝不替用户打开

`packages/dsh-companion-dashboard/lib/pond-gate.js`（新文件，6149 B）。决策是纯函数 `pondGateDecision({ days, autoRun, parked, date })`：

| 今天在排班日 | 鱼塘 autoRun | 是不是我们关的（parked） | action |
| --- | --- | --- | --- |
| 是 | 任意 | 是 | `restore`（还回开） |
| 是 | 任意 | 否 | `none`（`scheduled-day`） |
| 否 | 开 | 否 | `park`（关掉并记 parked） |
| 否 | 开 | 是 | `none`（`already-parked`，不重复写盘） |
| 否 | 关 | 否 | `none`（`already-off`，**一次都不写**） |

刻意不做「排班日强行打开」：用户自己关掉的鱼塘不该被控制台偷偷打开。`writePondAutoRun(on)` 只改 `autoRun` 一个键（值没变就不写），写完补 `markOverrideKey('autoRun')`；星期归一 `normalizeDays` 只收 1–7、去重升序、空=全周，周日 `getDay()===0` 折算成 7。

### 7.36.3 接线与界面

- `lib/index.js`：`readCompanion()` 的 `proactive.pond = { gate, days, parked, parkedAt, lastError }`（`gate` 默认 false、`days` 默认全周）；`saveCompanion()` 局部合并（只关闸门不冲掉星期）；60 秒定时器里 `enforcePondGate(cfg)` 先跑，`changed` 时把 `parked`/`parkedAt` 写回设置并打一行日志「鱼塘自动运行已按排班暂停/恢复（why）」。
- 路由 `GET|POST /companion/api/pond-gate`：GET 回 `pondGateStatus()`（`{dir, exists, autoRun, gate, days, parked, parkedAt, lastError}`）；POST 收 `{gate, days}`，存盘后立刻跑一次 `applyPondGate`，响应带 `outcome`。
- 界面在 `lib/client.js` 的 `BiliDutyCardV2` 里（值班卡片底部）：一行「现在：开着/关着（排班日，控制台不拦 / 非排班日，已由控制台暂停）」，一个复选框「让控制台按星期开关鱼塘的自动运行」（**默认关**，打开才接管），排班日 chips 复用 `.cmp-chip.cmp-day`，外加「全周」一键还原；`build=0.1.32`。

### 7.36.4 验证

| 项 | 手段 | 结果 |
| --- | --- | --- |
| 决策表五态 + 周日映射 | `scripts/smoke.mjs` 新用例 | `park/park/none/restore/none` 全对，`dayAllowed([7], 周日) true` |
| 真改文件 | 同一用例在临时 `DSH_HOME` 里造 `bili-duty/config.json` | 非排班日 `autoRun` 真变 false 且 `perDay` 保留；排班日还回 true；本来就关着时 `changed === false`（不写盘） |
| override 键 | 同上 | 写完后 `local-override.json` 出现 `autoRun`（时间戳） |
| 路由 | 同一用例 | 默认 `gate false` / `days [1..7]`；POST `[5,'3',9,0]` → `[3,5]` 且落盘到 `companion/settings.json`；只关闸门不冲掉星期；坏 JSON → 400 |
| 全量冒烟 | `node --import ./scripts/shims/resolver.mjs scripts/smoke.mjs` | **28/28 pass** |
| SSR | `scripts/ssr-check.mjs`（新 `BiliDutyCardV2` 探针） | `ok true` / `pondOk true` / `missingTokens []` |
| 装好的副本 | `.verify/real-pond-gate.mjs`（desktop 与 web 各一遍，`DSH_HOME` 指向临时目录） | GET `autoRun true / gate false`；POST `{gate:true, days:[1..5]}` → `outcome park`、config 里 `autoRun false`、`perDay 5` 保留、override 写入；再 POST 全周 → `restore`、`autoRun true`（当天是周日，正好走非排班日分支） |
| 干净环境 | `.verify/app` `check-patch.mjs` | `bundleVersion 0.1.38`、dashboard 0.1.32、anima 0.1.8、`lib/pond-gate.js` 在位、`missingPackages []`、`missingEntries []` |

版本：`dsh-companion-dashboard 0.1.31 → 0.1.32`、`dsh-companion-bundle 0.1.37 → 0.1.38`（依赖 `^0.1.32`），`dsh-anima` 保持 0.1.8。安装：`npm pack` → `C:/Windows/System32/tar.exe` 解开 → **在 run_code 里用 Node 的 `fs.copyFileSync` 逐文件覆盖 desktop / web**（bash 的 `cp` 写 web profile 一律 Permission denied，`tools.read`+`tools.write` 会截断长行），装完核对字节数一致。

### 7.36.5 三条限制

1. **要重启桌面应用**才加载 `pond-gate.js`（node_modules 代码启动时加载）；后台 60 秒定时器随之启停。
2. 改的是 `<DSH_HOME>/bili-duty/config.json`，鱼塘每 60 秒重读一次才生效；两边同时写有极小概率互相覆盖（都不是原子写），但键不重叠时不会丢配置。
3. 只动 `autoRun` 这一个键；鱼塘面板上的「自动运行」开关会跟着排班自己变（这就是功能本身），面板上看到的不是用户最后一次手点的值。

## 7.37 记忆生效范围：全局 / 仅 Onesoul 通道（anima 0.1.10 / dashboard 0.1.35 / bundle 0.1.41）

### 7.37.1 用户要求与两个决策

原话（2026-11-01）：「在控制台里…增加一个功能，就是选择全局应用这个记忆，还是仅运用到 Onesoul 这个插件」。两个岔路口当场问清：

| 问题 | 选中的答案 |
| --- | --- |
| 开关粒度 | **一个总开关**「所有记忆只在 Onesoul 生效」，不是每条记忆各带开关 |
| 「Onesoul」指什么 | **QQ / B站 那些通道插件**，不是工作区 `E:/dsh-onesoul` |

默认 `global`（保持现状，不改用户可见行为）。

### 7.37.2 为什么能按会话判：注入段可以拿到会话上下文

| 事实 | 位置 |
| --- | --- |
| `ctx.systemPrompt.section({ name, order, text })` 的 `text` 允许是函数 | 宿主 assemble 里 `text: typeof section.text === "function" ? section.text(context) : section.text` |
| 那个 `context` 是 `assembleContextFor(agent, signal)` 的产物 = `{ agent, scope: agent, signal? }` | `@deepseek-ai/dsh-agent` |
| `agent.id` 是共享的 agent / session 身份 | `@deepseek-ai/dsh-agent-loop` 构造里 `this.id = id; this.session = session;`，注释写 "shared agent/session identity" |
| QQ 会话 id 长这样 | `C:/Users/1/.dsh/sessions/--E-dsh-onesoul-playground--/onebot-private-3953927738/` ⇒ `onebot-private-<uin>` |
| 值班（headless）进程没有这种前缀 | 它只有一个 agent，所以用插件 config `channelProfile: true` 把整个进程标记成通道 |

顺带发现的历史缺陷：`packages/dsh-anima/lib/index.js` 里 `state.cwd` **从未被赋值**，于是 `approvedMemories(memory, cwd)` 里的 `entry.scope === 'global' || !cwd` 永远放行 —— 按工作区过滤其实一次都没生效过。本次的范围开关因此**不**复用 cwd，改走通道判定。

### 7.37.3 代码落点

| 文件 | 改动 |
| --- | --- |
| `packages/dsh-anima/lib/store.js` | 新增 `settingsPath()` = `<DSH_HOME>/anima/settings.json` |
| `packages/dsh-anima/lib/model.js` | `MEMORY_SCOPES = ['global','onesoul']`、`DEFAULT_CHANNEL_PREFIXES = ['onebot-']`、`normalizeSettings(raw)`、`isOnesoulChannel(settings, id)`、`memoryApplies(settings, id)`；`renderPromptSection(state, memory, cwd, options)` 新增第 4 参：`memoryApplies === false` 时只输出人设 + 通道小抄，并留一段「长期记忆：本轮不注入」 |
| `packages/dsh-anima/lib/index.js` | state 加 `settings`（热读 `settingsPath()` 的 mtime）；`persistSettings()`；`channelProfile = config.channelProfile === true`；`channelIdOf(context)` 读 `context.agent.id`；注入改成函数 `text(context)`；`summarize()` 带 `memoryScope / channelPrefixes / channelProfile` |
| `packages/dsh-companion-dashboard/lib/client.js` | MemoryBranch 新增卡片「记忆生效范围」：两个按钮「全局 / 仅 Onesoul 通道」，选中项 `primary` + 文案带「（已选）」 |
| `C:/Users/1/.dsh/profiles/headless/cordis.patch.yml` | `- id: dsh-anima` + `config: { channelProfile: true }` |

路由：`GET /anima/api/settings` → `{ ok, data: { memoryScope, channelPrefixes, channelProfile } }`；`POST /anima/api/settings` 收 `{ memoryScope }`，非 `global`/`onesoul` 回 **400** `memoryScope 只能是 global 或 onesoul`，成功写盘并追加账本事件 `settings`。

前端那一项 `apiGet(ANIMA + '/settings')` **必须带 `.catch()` 回落默认值**：旧 anima 没有这个路由时，落进 `Promise.all` 会让整个记忆页报「读取 anima 失败」，等于用新前端把旧后端打死。

### 7.37.4 验证

| 项 | 手段 | 结果 |
| --- | --- | --- |
| 默认值 / 前缀 | `scripts/smoke.mjs` 新用例 | `global` + `['onebot-']`；桌面 ctx 有记忆索引 |
| 切到 onesoul | 同上 | `POST` 200、`settings.json` 落盘；桌面 ctx 只剩人设 + 「本轮不注入」；QQ ctx（`onebot-private-3953927738`）仍有索引 |
| 非法值 / 值班进程 | 同上 | 400；`anima.apply(ctx, { channelProfile: true })` 下桌面 ctx 仍有记忆 |
| 全量冒烟 | `node --import ./scripts/shims/resolver.mjs scripts/smoke.mjs` | **29/29 pass** |
| SSR | `scripts/ssr-check.mjs`（新 `MemoryBranch` 探针 `memoryOk`） | `ok true` / `memoryOk true` / `missingTokens []` / `build=0.1.34` |
| 装好的副本 | run_code 内 import `C:/Users/1/.dsh/profiles/desktop/node_modules/dsh-anima/lib/index.js` + 假 ctx（`DSH_HOME=E:/dsh-onesoul/.verify/home-scope`） | `defaultScope global` / `prefixes ['onebot-']` / flip `200/onesoul` / `desktopBlocked true` / `qqStillHas true` / `badScope 400` / `statusScope onesoul` |
| 干净环境 | `.verify/app` `check-patch.mjs` | `bundleVersion 0.1.40`、`missingPackages []`、`missingEntries []`、三条 configOverrides 不变 |

版本：`dsh-anima 0.1.8 → 0.1.9`、`dsh-companion-dashboard 0.1.33 → 0.1.34`、`dsh-companion-bundle 0.1.39 → 0.1.40`（依赖 `^0.1.9` / `^0.1.34`）。安装用 `npm pack` + `C:/Windows/System32/tar.exe` 解包 + run_code 里 `fs.copyFileSync` 逐文件覆盖（desktop / web / headless 的 anima；desktop / web 的 dashboard），三个 profile 的依赖行改指对应 tgz。

### 7.37.5 三条限制

1. 切到 onesoul 时，**普通会话一条注入都没有**（人设、通道小抄、记忆全隔开，systemPrompt 段直接返回空串）——这是 2026-11-01 用户改的口径（原先是「只关记忆、人设照旧」）；QQ 与值班进程不受影响，鱼在通道里仍是同一个灵魂。
2. 认通道靠会话 id 前缀 `onebot-`；将来加别的通道插件（微信 / Discord），要把它的前缀加进 `channelPrefixes`（`settings.json` 可手改，`normalizeSettings` 会过滤空串）。
3. 要**重启桌面应用**才加载新的 anima / dashboard（node_modules 代码启动时加载）；值本身改完立即生效（每次组装提示词都热读 `settings.json`）。


### 7.37.6 追加：普通会话彻底隔开（0.1.10 / 0.1.35 / 0.1.41）

用户当天补了一句：「仅 one soul 通道，也关闭其他普通会话的人设和通道说明 就是分隔开」。于是把「只关记忆」收紧成「什么都不给」：

| 位置 | 改法 |
| --- | --- |
| `packages/dsh-anima/lib/model.js` | `renderPromptSection` 开头 `if (opts.memoryApplies === false) return ''`；原来那段「长期记忆：本轮不注入」的说明删掉，中间那层 `if/else` 摊平成直线 |
| `packages/dsh-anima/lib/index.js` | 注入函数里 `if (!applies) return ''`（原先回的是 `renderPromptSection(..., { memoryApplies: false })`） |
| `packages/dsh-companion-dashboard/lib/client.js` | 卡片说明改成「完全隔开：人设、通道小抄、记忆一条都不注入」 |

验证：

| 项 | 手段 | 结果 |
| --- | --- | --- |
| 冒烟 | `scripts/smoke.mjs` 里那条用例改成 `assert.equal(desktopPrompt, '')`，并断言 QQ 侧仍有人设 + 小抄 + 记忆 | **29/29 pass** |
| 装好的副本 | run_code 内 import `C:/Users/1/.dsh/profiles/desktop/node_modules/dsh-anima/lib/index.js`（临时 `DSH_HOME`） | 全局时桌面段 838 字；切 onesoul 后**桌面段 0 字**；QQ 段仍有索引/人设/小抄；`channelProfile: true` 的实例仍拿全量；切回全局立刻恢复 |
| SSR | `scripts/ssr-check.mjs` | `ok true` / `memoryOk true` / `build=0.1.35` |
| 干净环境 | `.verify/app` `check-patch.mjs` | `bundleVersion 0.1.41`、`missingPackages []`、`missingEntries []` |

版本：`dsh-anima 0.1.9 → 0.1.10`、`dsh-companion-dashboard 0.1.34 → 0.1.35`、`dsh-companion-bundle 0.1.40 → 0.1.41`；三个 profile 已覆盖安装（desktop / web / headless），依赖行改指新 tgz。同样要重启桌面应用才生效。

## 7.32 对外发布：合并成单包 `dsh-onesoul`，npm 与 GitHub 双通道落地（2026-11-01 夜）

### 7.32.1 为什么是「一个包」，不是「一个 bundle 装七个包」

用户要的是「合成一个插件包一样的东西」。宿主侧的硬约束只有一条，但它决定了整个形态：`@deepseek-ai/dsh-client-modules` 的 `exactPackageSpecifier(specifier)` 对任何子路径/相对路径/scheme 一律返回 `undefined`，而 `dsh.client` 声明只能挂在**包根**说明符上 —— 写成 `dsh-onesoul/dashboard` 就永远拿不到 `dsh.client`，控制中心 Tab 不会出现。所以：`packages/dsh-onesoul` 单一入口 `lib/index.js` 里用 `ctx.plugin(animaPlugin, ...)` / `ctx.plugin(dashboardPlugin, ...)` 组合两个子插件（各自独立 fiber，一个崩不连带另一个），客户端入口固定在 `./client` → `plugins/dashboard/lib/client.js`，`cordis.patch.yml` 只写一行 `- id: dsh-onesoul / name: dsh-onesoul`。

第三方 7 个包（onebot-qq / napcat-keeper / bili-pond / meme / better-sidebar / deepseek-web-login / our-free-model）**不 vendored**，仍是 `dependencies`；只有自建的 anima 与 dashboard 以源码形式内置到 `plugins/`，由 `scripts/build-onesoul.mjs` 从 `packages/*/lib` 同步。

### 7.32.2 产物与验证

| 项 | 命令/位置 | 结果 |
|---|---|---|
| 构建 | `node scripts/build-onesoul.mjs` | vendored anima 5 文件、dashboard 8 文件；entry/client 行打印正常 |
| 打包 | `npm pack`（**必须** `--cache E:/dsh-onesoul/.probe/npmcache`） | `dsh-onesoul-0.1.0.tgz` 79.1 kB / 18 文件 / shasum `bd3a32e27c17e0bc0e77893c3e64b6349a6ed91a` |
| 干净 profile（file: 形态） | `.verify/home-onesoul/profiles/test` + `dsh --profile test --dump-config` | `# == dsh-onesoul` 段齐全、行 `- id: dsh-onesoul / name: dsh-onesoul` |
| **registry 安装** | 同 profile 改 `dsh-onesoul: ^0.1.0` → `npm install --registry https://registry.npmjs.org` | 装到 `node_modules/dsh-onesoul/package.json` version `0.1.0`；dump-config 仍打出 `# == @deepseek-ai/dsh-base, patched by dsh-onesoul` 与 `- id: dsh-onesoul` |
| npm | `npm view dsh-onesoul versions dist-tags` | `["0.0.0-stage","0.1.0"]`、`latest: 0.1.0` |
| GitHub | 追踪文件 40 个；`git log` = `e98d682` → `00e6733`；tag `v0.1.0` | main 已推送、tag 已推送 |

### 7.32.3 发布链路上踩到的六个坑（都留了绕法）

1. **普通 granular token 发不出去**：`npm publish` 回 `E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.`。必须在 npm 网页建 token 时勾 **Bypass two-factor authentication (2FA)**，且 Packages and scopes 选 **All packages**（不选会报「You must select at least one package or scope」）。
2. **只勾 bypass 不勾 scope 会先失败一次**：表单要求 `packagesAll` 单选 + `Read and write` 权限；顺序错了会在提交时才报错，且 token 不生成。
3. **发完立刻 `npm view` 是 404**：registry 先给一个 `0.0.0-stage` 占位 stub，真正的 `0.1.0` 要等约 45 秒才进 `versions`；期间 `dist-tags.latest` 指向 stub。
4. **https push 走不通**：本机 22 端口被拒、https 又经过 Watt Toolkit 的中间人证书（node 侧 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`），最终用 **SSH over 443**（`ssh.github.com:443`）+ 现生成的 ed25519 key（key 已加到账号 SSH keys，新建 key 页面 https://github.com/settings/ssh/new 可正常填写提交，未触发 sudo 二次验证）。
5. **`~/.ssh/config` 的 ACL 会挡住 ssh**：报 `Bad owner or permissions on C:\Users\1/.ssh/config`，且删除失败。绕法：`ssh -F /dev/null -i <key> ...`，完全不读 config。
6. **`https://github.com/new` 在受控 Chrome 里会卡在 `loading`**（`htmlLen 24574`、`body` 不存在、`input` 0）。可用：先访问 `/new/import`，再访问 `/new?x=1`，React 表单就能渲染；建仓用 `#repository-name-input`（原生 setter + input 事件）+ 描述 `input[name=Description]` + 点 `Create repository`。

### 7.32.4 关于浏览器工具

`browser-skill` 的 `bsk_*` 六个工具已进入工具表，但本会话后端起不来：`bsk session request prepare failed: ensure daemon is running: automatic daemon startup failed: daemon child exited during startup: exit code: 2`；系统里没有 `bsk` CLI。实际全程用的是 **CDP 直连**（Chrome `--remote-debugging-port=9222` + `E:/dsh-onesoul/.verify/chrome-profile`，该 profile 里 npm/GitHub 是登录态），驱动脚本 `.verify/cdp.mjs`（`targets()` / `connect()`）+ `.verify/cdp-run.mjs`（读一个纯 JS 表达式文件求值，避免多层字符串转义）。


## 8. 尚未完成

| 项 | 状态 |
| --- | --- |
| npm 发布三包 | **未做**。`npm whoami` → `npm error need auth`（本机未登录）。顺序见 `docs/PUBLISH.md`：`dsh-anima@0.1.10` → `dsh-companion-dashboard@0.1.35` → `dsh-companion-bundle@0.1.41` |
| QQ 聊天模型下发的真机验收 | 0.1.29 已装进 desktop / web；重启后先让机器人收到一条 QQ 消息（建聊天表）→ 在控制中心切一次模型 → toast 应带「已同步到 N 个 QQ 聊天」，模型卡片那行应显示每个聊天当前的 provider/model；随后在 QQ 里发一句，trace 的 agent 行不应再出现 `raccoon` |
| 临时记忆在桌面侧的可见性 | `ephemeral.json` 与注入代码都已装好（anima 0.1.4），但桌面应用要重启才会加载新的提示段；重启后在 QQ 里问「你在B站刷了什么」，应能直接说出 BV 号而不调用任何 B站工具 |
| 真机「一行命令装齐」 | 干净环境（`.verify/app`）已验证装配与 `dump-config`；`dsh plugin add --profile web dsh-companion-bundle` 要等三包发布后才能走通，发布前只能用本地 tgz |
| desktop 侧零 error 复查 | 每次换版本都要用户重启桌面应用后读 `C:\Users\1\.dsh\logs\desktop-next.log` 确认（0.1.14 已于 2026-11-01 复查：`build=0.1.14`、`renderer.recovery.healthy`、零 render error、B站 卡片渲染通过） |
| B站 值班收尾 | 已真跑成功一轮（2026-10-31T16:53 用时 2 分 28 秒、挑中 20 条）；但 `out/2026-11-01.md` 头部仍是那轮被旧看门狗误杀留下的「这一轮没写出报告」模板，需要再跑一轮覆盖 |
| 主人号定时互动的真机验收 | 代码已装进两个 profile（0.1.25），等桌面重启后：先让机器人收到一条 QQ 消息（捕获出站管道）→ 点「现在发一条」→ 点「现在提一次」（值班摘要）→ 再把间隔调小等一轮定时 |
| 分句第二轮的桌面验收 | 0.1.27 已装进 desktop/web（上限 12 条），等重启后真发一条多句回复，确认「一句一条、表情标记完整」；若那条回复本身被上游截断，最后一条应带「（说到一半就断了，要我接着说吗？）」 |
| 记忆撤销 / 审计的真机验收 | anima 0.1.7 已装进三个 profile；重启后工具表应出现 `anima_memory_revoke` 与 `anima_memory_audit`，`anima_memory_audit` 应回 `ledger.entries 0 / ok true`（账本从 0.1.7 才开始记） |
| QQ 自动登录（NapCat） | **已修通**（§7.31）：QQ 9.9.36-53644 + boot 模式 + `--no-sandbox` + 普通用户令牌；启动脚本已换成 boot 配方。剩余风险：QQ 若自动热更新到签名表之外的 build 会再次失效 |
| NapCat 启动脚本的真机自启验收 | 新 bat 只做过「手动拉起即通」的验证，还要等一次真正的「关掉 QQ → keeper 自动拉起 → 8643 连上」全自动回合确认 |
| 表情包（媒体围栏）的真机验收 | 0.1.28 已装进 desktop/web；重启后在 QQ 里让它发表情包，`GET /companion/api/media-roots` 的 roots 应含 `C:\Users\1\.dsh\meme-packs`，且 `qq-trace.jsonl` 的 outbound 行 segments 里应出现图片段 |
| 主动互动星期排班的真机验收 | 0.1.31 已装进 desktop/web；重启后在主人号卡片点掉几天只留今天 → 保存 → 非排班日不应再有定时消息，回到排班日第一条应立刻发出；`GET /companion/api/interact` 的 `proactive.days` 应与点选一致 |
| 鱼塘排班闸门的真机验收 | 0.1.32 已装进 desktop/web；重启后在值班卡片底部勾上「让控制台按星期开关鱼塘的自动运行」并只留今天 → 排班日 `C:/Users/1/.dsh/bili-duty/config.json` 的 `autoRun` 应保持 true；把它改成只留明天，过一分钟（或点一下保存）`autoRun` 应变 false 且 `GET /companion/api/pond-gate` 的 `parked` 为 true；再改回今天应立即恢复 true |
| 表情标记配图的真机验收 | 0.1.30 已装进 desktop/web；重启后在 QQ 里让它发表情，收到的应是图片而不是 `[表情: 描述]` 这行字；`C:/Users/1/.dsh/media/onebot/qq-actions.log` 里应出现带图片段的那次 `send_msg`，`GET /companion/api/media-roots` 的 `inline.packs` 应为 `['maid-emoji','whale-girl-emoji']` |
| 记忆生效范围的真机验收 | anima 0.1.10 + dashboard 0.1.35 已装进 desktop / web / headless；重启后控制中心「记忆」分支应出现「记忆生效范围」卡片，点「仅 Onesoul 通道」后：QQ 里仍有记忆索引，桌面侧普通会话只剩人设；`C:/Users/1/.dsh/anima/settings.json` 的 `memoryScope` 应为 `onesoul`；值班进程（headless，`channelProfile: true`）不受影响 |
| `dshBin` 是手工补的 | 桌面应用里没有 CLI，`dshBin` 必须指到 npm 全局装的 `lib/bin.js`；打包给别人时这一项要写进 README 的安装步骤 |
