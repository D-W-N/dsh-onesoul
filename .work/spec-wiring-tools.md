# 任务：只写「四个新工具注册」这一段代码（不要写其它任何东西，不要解释）

## 插入位置（这段代码要插在下面 `}))` 之后、`  }` 之前，缩进 4 空格）
```js
  }

  // ---- HTTP routes: the dashboard reads and adjudicates through these ----
  // webServer 不能写进静态 inject：headless 值班 profile 没有它，硬依赖会让插件永不激活。
  // 也不能只在 apply 里抓一次：apply 可能早于 webServer 就绪，抓到 null 就永远挂不上
  // （2026-11-01 桌面端控制中心读 /anima/api/status 得 HTTP 404 正是这个原因）。
  // 做法：现在就绪就立刻挂；还没就绪就用 ctx.inject 等它出现再挂。
  function pickWebServer(scope) {
    try {
      return scope && typeof scope.get === 'function' ? scope.get('webServer') : null
    } catch (error) {
```

## 已存在的工具注册写法（照这个样式，必须完全一致的结构）
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

## 已存在的「写盘必须串行」写法（所有会写文件的 execute 都要这样包）
```js
        }), null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_memory_import',
      description: '从外部 AI 的历史记忆文本批量导入（Markdown 项目符号/编号/段落）。全部落为候选，仍需逐条裁决；dryRun 只返回将导入的条目。',
      parameters: {
        text: { type: 'string', required: true, description: '要导入的原始文本' },
        source: { type: 'string', description: '来源标注，默认 import' },
        dryRun: { type: 'boolean', description: '只预览不写入' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          refreshSync()
          const items = extractCandidateTexts(args.text)
          if (!items.length) return '没有解析出可导入的条目。'
          if (args.dryRun === true) {
            return '预览（' + items.length + ' 条，未写入）：\n' + items.map(function (item, index) { return (index + 1) + '. ' + item }).join('\n')
          }
```

## 可用的 runtime.js API（已存在，勿改；只能通过 import 使用）
```js
summarizeRuntime(runtime, nowIso) -> string       // Markdown，首行 '## 此刻的状态'，其中有一行以 '- 说话门：' 开头
applyRuntimeEvent(runtime, event, nowIso) -> runtime
describePresence(presence, nowIso) -> string      // 一句话，如「她在书房，看书」
describeMood(mood) -> string                      // 一句话，如「心情：平静」
```
## state 上已有的字段（插件内部变量，直接用）
```js
state.runtime        // 当前 runtime 对象（已可能被外部手改，用前不必再读盘）
state.runtime 结构：{ quiet, presence, mood, routine, quietCfg, updatedAt }
```

## 要写的四个工具（用 defineTool + toolService.register，参数 schema 用 `{ type, description, required }` 风格）
1. `anima_state_get`：无参数。返回 summarizeRuntime(state.runtime, nowIso()) + "\n\n" + JSON.stringify(state.runtime, null, 2)。不写盘，不用 serialize。
2. `anima_presence_move`：参数 room（string, required）、activity（string 可选）、minutes（number 可选）。先 applyRuntimeEvent(state.runtime, { type: "move-to", room, activity, minutes }, nowIso()) 赋回 state.runtime，再 await persistRuntime()，返回 describePresence(state.runtime.presence, nowIso())。
3. `anima_mood_note`：参数 text（string, required）。applyRuntimeEvent(state.runtime, { type: "message", text }, nowIso()) 赋回，await persistRuntime()，返回 describeMood(state.runtime.mood)。
4. `anima_quiet`：参数 action（string, required，说明里列出 goodnight/goodmorning/override/suppressed）、minutes（number 可选）、text（string 可选）、kind（string 可选）。event 固定为 { type: action, minutes, text, kind }，赋回 + persistRuntime()，然后用 String(summarizeRuntime(state.runtime, nowIso())).split("\n").find(l => l.startsWith("- 说话门：")) 取那一行返回（取不到就返回 "说话门：未知"）。

## 硬约束
- 只输出一段可直接粘贴的 JS 代码，用 ```js 包住；不要输出 import 行、不要输出其它块。
- 四个工具的顺序就按上面 1..4。
- description 中文，写「什么时候该用」；参数不带 required 的不要写 required。
- 不要新增全局变量，不要改 state 之外的东西。
