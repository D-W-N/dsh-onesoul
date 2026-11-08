# 任务：为 dsh-anima 的 index.js 写接线补丁（只输出补丁块，不要解释）

## 目标文件
`packages/dsh-anima/lib/index.js`（ESM，719 行，插件工厂函数内部）。

## 现状 A：refreshSync（第 112-130 行）
```js
  function refreshSync() {
    const pStamp = stampOf(personaPath())
    if (pStamp !== state.personaStamp) {
      state.personaStamp = pStamp
      state.persona = normalizeState(readJsonSync(personaPath(), null))
    }
    const mStamp = stampOf(memoryPath())
    if (mStamp !== state.memoryStamp) {
      state.memoryStamp = mStamp
      state.memory = normalizeMemory(readJsonSync(memoryPath(), null))
    }
    const sStamp = stampOf(settingsPath())
    if (sStamp !== state.settingsStamp) {
      state.settingsStamp = sStamp
      state.settings = normalizeSettings(readJsonSync(settingsPath(), null))
    }
  }

  async function persistPersona() {
```

## 现状 B：提示词注入（第 206-230 行）
```js
  // ---- system prompt injection: the single reason all channels share one soul ----
  let systemPrompt = null
  try { systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : null } catch (error) { systemPrompt = null }
  if (!systemPrompt) { try { systemPrompt = ctx.systemPrompt || null } catch (error) { systemPrompt = null } }
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    ctx.effect(function () {
      return systemPrompt.section({
        name: SECTION_NAME,
        order: 5,
        text: function (context) {
          try {
            refreshSync()
            const channelId = channelIdOf(context)
            const applies = channelProfile === true || memoryApplies(state.settings, channelId)
            if (!applies) return ''
            return renderPromptSection(state.persona, state.memory, state.cwd) + renderEphemeralSection(ephemeralSync())
          } catch (error) {
            return '## 你的人设（dsh-anima）\n人设读取失败，按默认助手身份回答，并提示用户检查 ' + animaDir() + '。'
          }
        },
      })
    })
  }

  // ---- tools ----
```

## 现状 C：工具注册样板（第 235-249 行）
```js
    toolService.register(defineTool({
      name: 'anima_status',
      description: '读取 dsh-anima 的当前状态：生效人设、待审/已确认/已拒绝记忆条数、存储路径。',
      parameters: {},
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute() {
        return JSON.stringify(summarize(), null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_persona_get',
      description: '读取当前生效的人设（含全局人设与工作区覆盖结果）。',
      parameters: {
        cwd: { type: 'string', description: '工作区绝对路径；省略则用当前工作区' },
```

## 现状 D：工具段结尾（第 549-556 行）
```js
  // webServer 不能写进静态 inject：headless 值班 profile 没有它，硬依赖会让插件永不激活。
  // 也不能只在 apply 里抓一次：apply 可能早于 webServer 就绪，抓到 null 就永远挂不上
  // （2026-11-01 桌面端控制中心读 /anima/api/status 得 HTTP 404 正是这个原因）。
  // 做法：现在就绪就立刻挂；还没就绪就用 ctx.inject 等它出现再挂。
  function pickWebServer(scope) {
    try {
      return scope && typeof scope.get === 'function' ? scope.get('webServer') : null
    } catch (error) {
```

## 现状 E：持久化样板（第 131-145 行）
```js
    state.personaStamp = 'writing'
    await writeJson(personaPath(), state.persona)
    state.personaStamp = stampOf(personaPath())
  }

  async function persistSettings() {
    state.settingsStamp = 'writing'
    await writeJson(settingsPath(), state.settings)
    state.settingsStamp = stampOf(settingsPath())
  }

  async function persistMemory() {
    state.memoryStamp = 'writing'
    await writeJson(memoryPath(), state.memory)
    state.memoryStamp = stampOf(memoryPath())
```

## 可用的 runtime.js API（已存在，勿改）
```js
runtimePath() -> string
emptyRuntime(nowIso) -> runtime
normalizeRuntime(raw, nowIso) -> runtime
applyRuntimeEvent(runtime, event, nowIso) -> runtime   // event.type: 'message'|'move-to'|'goodnight'|'goodmorning'|'override'|'suppressed'|'tick'
summarizeRuntime(runtime, nowIso) -> string            // 返回 Markdown 段，以 '## 此刻的状态' 开头
```

## 要求（输出三块补丁，用 ```js 包住，块之间用一行 `---` 分隔）
1. 第 1 块：refreshSync 的新版本（整函数替换），在 settings 之后加 runtime 热加载，用 `runtimeStamp` 对比 `stampOf(runtimePath())`，读 `readJsonSync(runtimePath(), null)` 交给 `normalizeRuntime(raw, nowIso())`；同时新增 `async function persistRuntime()`（照现状 E 的写法，把 state.runtime 写到 runtimePath()）。
2. 第 2 块：提示词注入 text 函数的新版本（整段替换），在原返回值后追加 `\n\n` + `summarizeRuntime(state.runtime, nowIso())`；注意 memoryApplies 为 false 时仍要 return 空串（保持「完全隔开」语义），且 summarizeRuntime 不抛异常（外面已有 try/catch，不要新增）。
3. 第 3 块：四个新工具注册代码，插在现状 D 的 `}))` 之后、`  }` 之前。用 defineTool + toolService.register 的既有写法，全部 `output: { schema: { type: "string" }, render: function (_args, value) { return textOf(value) } }`，全部包在已有的 `serialize(async function () { ... })` 里（写盘必须串行）：
   - `anima_state_get`：无参数，返回 `summarizeRuntime(state.runtime, nowIso())` + `\n\n` + JSON.stringify(state.runtime, null, 2)。
   - `anima_presence_move`：参数 room（string, required）、activity（string, 可选）、minutes（number, 可选）；事件 `{ type: "move-to", room, activity, minutes }`，写盘后返回 `describePresence` 的一句话（从 runtime.js 导入）或简短确认。
   - `anima_mood_note`：参数 text（string, required）；事件 `{ type: "message", text }`，写盘后返回 `describeMood(state.runtime.mood)` 结果。
   - `anima_quiet`：参数 action（string, required，取值 goodnight/goodmorning/override/suppressed）、minutes（number, 可选）、text（string, 可选）、kind（string, 可选）；映射到 `{ type: action, minutes, text, kind }`，写盘后返回 `summarizeRuntime` 里「说话门」那一行（用正则取以 `- 说话门：` 开头的行）。

## 硬约束
- 只能改这三处，不要动其它任何代码，不要重排已有工具。
- 需要新增 import 时，单独在最后写第 4 块：`// import 追加` 加上要加的 `import { describePresence, describeMood, runtimePath, normalizeRuntime, summarizeRuntime } from "./runtime.js"`（按实际需要裁剪，但必须真的用到）。
- 工具 description 用中文，写清「什么时候该调」而不是复述参数。
- 不写注释以外的解释文字。
