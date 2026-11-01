# dsh-companion-bundle

只做装配的聚合包：`dependencies` 声明 8 个子插件，`cordis.patch.yml` 一个 `insert` 块按序插入 9 行，
`lib/index.js` 仅 `export {}`。**不含任何功能代码**，也**不物理合并**子插件——DSH 逐行独立加载，一处 `apply` 失败不影响其他行。

## 行顺序

| # | id | 包名 | 说明 |
|---|---|---|---|
| 1 | `dsh-better-sidebar` | `dsh-better-sidebar` | 侧边栏宿主（`ctx.betterSidebar`） |
| 2 | `dsh-anima` | `dsh-anima` | 灵魂层：人格 + 记忆裁决 |
| 3 | `dsh-deepseek-web-login` | `dsh-deepseek-web-login` | 网页版 DeepSeek 接成原生 provider（路由 `deepseek-web`） |
| 4 | `dsh-onebot` / `onebot-settings-remote` | `dsh-onebot-qq` | QQ 真人号通道（OneBot11 反向 WS，默认 127.0.0.1:8643） |
| 4b | `napcat-keeper` | `dsh-napcat-keeper` | NapCat 看门狗 + 登录态（`/dsh-napcat-keeper/state`） |
| 5 | `dsh-bili-pond` | `dsh-bili-pond` | B站只读通道 |
| 6 | `dsh-meme` | `dsh-meme` | 表情包图库 |
| 7 | `dsh-companion-dashboard` | `dsh-companion-dashboard` | 控制中心 Tab |

## 安装

```bash
dsh plugin add --profile web dsh-companion-bundle
```

必须来自 npm registry（pnpm 不解析 `github:` tarball 的 dependencies）。

## 版本约束

- `dsh-better-sidebar` 固定 `^0.26.1`：0.28.x 要求 `@deepseek-ai/dsh-agent ^0.2.1-rc.1`，在 DSH 0.2.0-rc.2 上会被自动禁用（Tab 消失）。
  DSH 升到 ≥0.2.1-rc.1 后再升到 `^0.28`。
- 发布顺序：`dsh-anima` → `dsh-companion-dashboard` → `dsh-companion-bundle`（聚合包依赖前两者）。

## patch 写法红线

- `name` 必须是**实际 npm 包名**（写错 = 启动期 `Cannot find package`）。
- 不要在 patch 里硬编码本机绝对路径。
- 行 `id` 可以为了兼容保留旧名，但 `name` 不能偷懒。

## accessToken（装完必须一致）

文件末尾有两条顶层同 id 覆写行，把 `dsh-onebot` 与 `napcat-keeper` 的 `accessToken` 都设为 `dsh-companion-onebot`。
`dsh-onebot-qq/lib/connection.js:250` 在 token 为空时直接抛 `reverse mode requires a non-empty accessToken`（整行不激活）；
两边不一致时 NapCat 会被 4401 拒绝。要改就两边同时改，别只改一处。
