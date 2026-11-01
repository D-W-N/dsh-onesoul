# dsh-companion-dashboard

「控制中心」侧边栏 Tab：把记忆裁决、QQ、B站、表情包的入口收敛到一个 Tab 内，**全程不跳转**。

## 浏览器半（`lib/client.js`）

- 以 `window.__ModuleLoader__.load({ id, factory })` 形式注册，`exports.inject = ['betterSidebar']`。
- 调 `ctx.get('betterSidebar').registerTab({ id: 'companion:control-center', title: '控制中心', order: 5, single: true, component })`。
- 内部四分支导航（记忆 / QQ / B站 / 表情包）由 React `createElement` 渲染，CSS 一次性注入（`cmp-` 前缀类名）。
- 记忆分支原生内嵌：读 `GET /anima/api/pending`，逐条「通过 / 拒绝」→ `POST /anima/api/decide`；支持人设编辑（`GET|POST /anima/api/persona`）与手动写入候选（`POST /anima/api/capture`）。

## Host 半（`lib/index.js`）

`GET /companion/api/status` 汇总：

- `branches[4]`：`memory | qq | bili | meme`，各带 `native`（是否原生内嵌）、`ready`、`hint`；
- `services`：扫 `$DSH_HOME/profiles/*/package.json` 的 `dependencies` 判断各插件是否已安装；
- `anima`：直接读 `<DSH_HOME>/anima/memory.json` 统计 pending/approved/rejected；
- `meme`：数 `<DSH_HOME>/meme-packs`。

所有读文件都 try/catch 降级，缺文件不报错。默认只监听 loopback（`allowLan: true` 放开）。

## 依赖

- 需要 `dsh-better-sidebar`（peer）提供 `ctx.betterSidebar`；Host 半不依赖它（该服务只在客户端半存在）。
- `export const inject = ['webServer']`（Host 半）；浏览器半 `inject = ['betterSidebar']`。

## 限制

QQ / B站 / 表情包三分支目前只给状态与「打开子插件面板」的提示，未内嵌 iframe：
子插件未暴露稳定的外部状态 API，内嵌需逐个确认。记忆分支已是原生实现。
