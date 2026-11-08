# 任务：实现 `packages/dsh-anima/lib/runtime.js`（把「静默门 / 在场 / 心情」三块拼成一份运行时状态）

你写的是**胶水层**：不重新实现任何业务规则，只做装配、持久化形状、以及给系统提示词用的一段摘要。
同目录已有三个模块，直接 `import` 它们，不要复制它们的逻辑：

```js
import { emptyQuiet, normalizeQuiet, reduceQuiet, canSpeak, noteSuppressed, minutesOfDay } from './quiet.js'
import { emptyPresence, normalizeRoutine, reducePresence, describePresence, DEFAULT_ROUTINE } from './presence.js'
import { emptyMood, normalizeMood, reduceMood, describeMood, suggestMusic, valenceLabel } from './mood.js'
import { animaDir } from './store.js'
```

（若 `mood.js` 没有导出 `normalizeMood`，就不要 import 它——按实际导出的名字来，只 import 真实存在的。）

## 硬性约束

- ESM；只允许 `node:` 内置模块＋上面这些同目录模块；无 `console.log`；2 空格缩进、单引号、无分号；80–160 行。
- 纯函数：不改入参。

## 需要导出的东西

```js
export function runtimePath()                        // animaDir() + '/runtime.json'
export function emptyRuntime(nowIso)
export function normalizeRuntime(raw, nowIso)       // 脏输入也要能返回可用结构
export function applyRuntimeEvent(runtime, event, nowIso)
export function summarizeRuntime(runtime, nowIso)   // 给系统提示词的多行中文摘要
```

## 状态形状

```js
{
  quiet: <quiet.js 的状态>,
  presence: <presence.js 的状态>,
  mood: <mood.js 的状态>,
  routine: <presence.js 的日程数组>,      // 缺省用 DEFAULT_ROUTINE 的深拷贝
  quietCfg: <quiet.js 的归一化配置>,
  updatedAt: ISO,
}
```

## normalizeRuntime

`raw` 可以是 `undefined`/`null`/对象/字符串；任何字段缺失或类型不对，就用对应模块的 `empty*()` 补上（`routine` 用 `normalizeRoutine(raw.routine)`，`quietCfg` 用 `normalizeQuiet(raw.quietCfg ?? raw.quiet)`）。
**不要**把坏掉的子状态整个丢掉——只补缺的字段（例如 `quiet` 存在但缺 `suppressed` 就补空数组）。
`updatedAt` 缺失时用传入的 `nowIso`。

## applyRuntimeEvent（事件分发，按 type）

- `'message'`：`mood = reduceMood(mood, event, nowIso)`；`quiet = reduceQuiet(quiet, { type: 'user-message' }, nowIso, quietCfg)`；`presence = reducePresence(presence, { type: 'user-message' }, nowIso, routine)`。
- `'goodnight'` / `'goodmorning'`：三块都收到同名事件（`presence` 收到的是 `{ type: 'tick' }`，因为位置模块没有这两个事件）。
- `'tick'`：三块都收到 `{ type: 'tick' }`。
- `'move-to'`：只给 `presence`。
- `'override'`：只给 `quiet`。
- `'suppressed'`：只给 `quiet`，用 `noteSuppressed(quiet, { kind: event.kind, text: event.text }, nowIso)`。
- 其它：原样返回（等价新对象）。
每次返回的新对象都要把 `updatedAt` 写成 `nowIso`。

## summarizeRuntime（给提示词看，必须精炼）

固定四行结构：

```
## 此刻的状态
- 位置：<describePresence 的原文>
- 心情：<describeMood 的原文>
- 说话门：<见下>
```

「说话门」三种说法（用 `canSpeak` + `quiet.state` 判断）：
- `quiet.state === 'quiet'` → `静默中（从 HH:MM 起，压着 N 条待说）`，`HH:MM` 用 `quietSince` 的**本地**时分；`N` = `suppressed.length`。
- `quiet.state === 'drowsy'` → `半睡了，只有急事才开口`。
- 其余 → `醒着，可以说话`。

另外，若 `describeMood` 里能看出偏向（`mood.valence < -0.15`），最后再补一行：
`- 提醒：她现在不太好，先接住情绪，别急着讲道理`。
若 `quiet.state` 是 `quiet` 且 `suppressed.length > 0`，再补一行：
`- 攒着的话：还有 N 条等她自己开口`。

任何一块抛异常或返回非字符串，都要能让 `summarizeRuntime` 仍然返回这四行（用兜底文案 `不知道`），**不许 throw**。

只输出 `runtime.js` 的完整文件内容，用 ```js 代码块包住。
