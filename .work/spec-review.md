# 任务：审查一份接线补丁，找真 bug（只输出发现的问题，不要复述代码）

## 背景
dsh-anima 是 DSH 插件，`index.js` 在 apply(ctx) 里注册工具、注入系统提示段、挂 HTTP 路由。刚加了「此刻的状态」运行时（静默门/在场/心情）接线。
新模块 `runtime.js` 提供：`runtimePath()`、`emptyRuntime(nowIso)`、`normalizeRuntime(raw, nowIso)`、`applyRuntimeEvent(runtime, event, nowIso)`、`summarizeRuntime(runtime, nowIso) -> Markdown`。
`store.js` 提供 `readJsonSync(path, fallback)`、`writeJson(path, value)`、`stampOf(path)`、`nowIso()`。
工具执行通过 `serialize(fn)` 串行化（写盘必须串行）。

## 补丁（git diff）
```diff
diff --git a/packages/dsh-anima/lib/index.js b/packages/dsh-anima/lib/index.js
index e718897..45ef9a8 100644
--- a/packages/dsh-anima/lib/index.js
+++ b/packages/dsh-anima/lib/index.js
@@ -34,6 +34,9 @@ import {
   refreshEphemeral,
   renderEphemeralSection,
 } from './ephemeral.js'
+import { applyRuntimeEvent, normalizeRuntime, runtimePath, summarizeRuntime } from './runtime.js'
+import { describePresence } from './presence.js'
+import { describeMood } from './mood.js'
 
 export { KEEP_DAYS, readEphemeralSync, refreshEphemeral, queryEphemeral, renderEphemeralSection, ephemeralSummary }
 export const name = 'dsh-anima'
@@ -99,7 +102,7 @@ export function apply(ctx, pluginConfig) {
   const allowLan = config.allowLan === true
   // 值班 profile 整个进程都算 Onesoul 通道（它没有 QQ 那种会话 id 前缀可认）。
   const channelProfile = config.channelProfile === true
-  const state = { persona: emptyState(), memory: emptyMemory(), settings: normalizeSettings(null), personaStamp: '', memoryStamp: '', settingsStamp: '', cwd: '' }
+  const state = { persona: emptyState(), memory: emptyMemory(), settings: normalizeSettings(null), personaStamp: '', memoryStamp: '', settingsStamp: '', runtime: normalizeRuntime(null, nowIso()), runtimeStamp: '', cwd: '' }
   let chain = Promise.resolve()
 
   function serialize(task) {
@@ -125,6 +128,11 @@ export function apply(ctx, pluginConfig) {
       state.settingsStamp = sStamp
       state.settings = normalizeSettings(readJsonSync(settingsPath(), null))
     }
+    const rStamp = stampOf(runtimePath())
+    if (rStamp !== state.runtimeStamp) {
+      state.runtimeStamp = rStamp
+      state.runtime = normalizeRuntime(readJsonSync(runtimePath(), null), nowIso())
+    }
   }
 
   async function persistPersona() {
@@ -139,6 +147,12 @@ export function apply(ctx, pluginConfig) {
     state.settingsStamp = stampOf(settingsPath())
   }
 
+  async function persistRuntime() {
+    state.runtimeStamp = 'writing'
+    await writeJson(runtimePath(), state.runtime)
+    state.runtimeStamp = stampOf(runtimePath())
+  }
+
   async function persistMemory() {
     state.memoryStamp = 'writing'
     await writeJson(memoryPath(), state.memory)
@@ -218,7 +232,7 @@ export function apply(ctx, pluginConfig) {
             const channelId = channelIdOf(context)
             const applies = channelProfile === true || memoryApplies(state.settings, channelId)
             if (!applies) return ''
-            return renderPromptSection(state.persona, state.memory, state.cwd) + renderEphemeralSection(ephemeralSync())
+            return renderPromptSection(state.persona, state.memory, state.cwd) + renderEphemeralSection(ephemeralSync()) + '\n\n' + summarizeRuntime(state.runtime, nowIso())
           } catch (error) {
             return '## 你的人设（dsh-anima）\n人设读取失败，按默认助手身份回答，并提示用户检查 ' + animaDir() + '。'
           }
@@ -543,6 +557,81 @@ export function apply(ctx, pluginConfig) {
         })
       },
     }))
+
+    toolService.register(defineTool({
+      name: 'anima_state_get',
+      description: '读取 anima 当前 runtime 状态（说话门、在场、心情、日程等）；需要查看或排查她此刻状态时使用。',
+      parameters: {},
+      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
+      async execute() {
+        return summarizeRuntime(state.runtime, nowIso()) + '\n\n' + JSON.stringify(state.runtime, null, 2)
+      },
+    }))
+
+    toolService.register(defineTool({
+      name: 'anima_presence_move',
+      description: '设置 anima 当前所在房间和活动；需要让她移动、换房间或记录所在位置时使用。',
+      parameters: {
+        room: { type: 'string', required: true, description: '要移动到的房间' },
+        activity: { type: 'string', description: '当前活动，如看书、工作；省略则不指定' },
+        minutes: { type: 'number', description: '预计停留分钟数；省略表示不设时限' },
+      },
+      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
+      async execute(args) {
+        return serialize(async function () {
+          state.runtime = applyRuntimeEvent(state.runtime, {
+            type: 'move-to',
+            room: args.room,
+            activity: args.activity,
+            minutes: args.minutes,
+          }, nowIso())
+          await persistRuntime()
+          return describePresence(state.runtime.presence, nowIso())
+        })
+      },
+    }))
+
+    toolService.register(defineTool({
+      name: 'anima_mood_note',
+      description: '记录一条会影响 anima 心情的消息或事件；需要根据对话、反馈或事件更新她心情时使用。',
+      parameters: {
+        text: { type: 'string', required: true, description: '要记录的消息或事件文本' },
+      },
+      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
+      async execute(args) {
+        return serialize(async function () {
+          state.runtime = applyRuntimeEvent(state.runtime, { type: 'message', text: args.text }, nowIso())
+          await persistRuntime()
+          return describeMood(state.runtime.mood)
+        })
+      },
+    }))
+
+    toolService.register(defineTool({
+      name: 'anima_quiet',
+      description: '控制 anima 的安静/说话门状态；需要晚安、早安、临时覆盖或抑制她说话时使用。',
+      parameters: {
+        action: { type: 'string', required: true, description: '动作：goodnight/goodmorning/override/suppressed' },
+        minutes: { type: 'number', description: '安静或覆盖持续分钟数；省略表示按默认' },
+        text: { type: 'string', description: '附带的说明文本' },
+        kind: { type: 'string', description: '安静/覆盖的类型标记' },
+      },
+      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
+      async execute(args) {
+        return serialize(async function () {
+          state.runtime = applyRuntimeEvent(state.runtime, {
+            type: args.action,
+            minutes: args.minutes,
+            text: args.text,
+            kind: args.kind,
+          }, nowIso())
+          await persistRuntime()
+          return String(summarizeRuntime(state.runtime, nowIso())).split('\n').find(function (line) {
+            return line.startsWith('- 说话门：')
+          }) || '说话门：未知'
+        })
+      },
+    }))
   }
 
   // ---- HTTP routes: the dashboard reads and adjudicates through these ----
```

## 请只回答这四件事
1. 有没有会在运行时抛异常的地方（空值、未定义变量、类型错）。
2. `refreshSync()` 在提示词注入的同步路径里被调用，而 `persistRuntime()` 是异步的——两者交替会不会导致「写盘后被热加载覆盖」或 stamp 抖动，从而导致每轮都重读盘。
3. 四个新工具的 `execute` 有没有漏掉必须的参数校验（比如 `room` 传了不存在的房间、`action` 传了非法值）。
4. 有没有明显的性能或正确性问题（比如每轮 JSON.stringify 大对象、把状态写进不该写的目录）。

输出格式：每条一行，`- [严重度] 文件:位置 — 问题 — 建议`。严重度用 P0/P1/P2。没有问题的项也写一行 `- 无`。
