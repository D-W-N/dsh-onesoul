# 任务：实现 `packages/dsh-anima/lib/quiet.js`（静默门）

你是给一个长期活着的 AI 写「作息门」的实现者。她的名字叫大肥鱼，主人叫她这么叫。
这个模块只做**纯逻辑**：不读文件、不联网、不碰宿主 API、不发消息。所有时间都由调用方以参数传入。

## 硬性约束

- ESM（`export`），只允许 `node:` 内置模块，**不要引任何第三方包**。
- 所有函数**纯**：不得修改传入的 `state` 对象，必须返回新对象。
- 不要写 `console.log`。不要写注释以外的解释性输出。
- 代码风格：2 空格缩进，单引号，无分号（与本仓库其它文件一致）。
- 目标行数 120–200 行，不要膨胀。

## 需要导出的东西

```js
export const QUIET_STATES = ['awake', 'drowsy', 'quiet']
export const DEFAULT_QUIET = { from: '23:30', to: '07:00', drowsyIdleMin: 25, quietIdleMin: 55 }

// '23:30' -> 1410；非法输入（null、'24:00'、'ab'）-> null
export function minutesOfDay(hhmm)

// 跨零点窗口判断：inWindow(1410, 1410, 420)===true, inWindow(60,...)===true, inWindow(420,...)===false
export function inWindow(nowMin, fromMin, toMin)

// 容错归一化：任何脏输入都要返回一个可用的完整配置，字段缺失/非法一律回落 DEFAULT_QUIET
export function normalizeQuiet(input)

// 初始状态
export function emptyQuiet(nowIso)

// 事件驱动：返回新 state
export function reduceQuiet(state, event, nowIso, cfg)

// 能不能出声：{ ok, reason }
export function canSpeak(state, nowIso, opts)

// 静默期被压下的东西入队（返回新 state）
export function noteSuppressed(state, item, nowIso)
```

## 状态形状

```js
{
  state: 'awake' | 'drowsy' | 'quiet',
  since: ISO 字符串,          // 进入当前状态的时刻
  lastUserAt: ISO|null,       // 主人最后一次说话
  quietSince: ISO|null,       // 本次静默开始时刻
  suppressed: [ { kind, text, at } ],   // 待说清单，按时间顺序，最多 50 条（超出丢最旧）
  overrideUntil: ISO|null,    // 破例截止时刻
}
```

## 事件语义（`event = { type, at? }`）

- `'goodnight'`：立刻进 `quiet`，`quietSince = nowIso`，`lastUserAt = nowIso`。
- `'goodmorning'`：进 `awake`。**`suppressed` 不清空**（那是要早上说出口的清单）。
- `'user-message'`：`lastUserAt = nowIso`；若当前是 `quiet` 则进 `awake`（人开口了就别装睡）；若 `drowsy` 也回 `awake`。
- `'tick'`：唯一会「自己动」的事件：
  - 若当前 `awake` 且 `inWindow(now, from, to)`：**且**没有 `lastUserAt` 或已空闲 ≥ `drowsyIdleMin` 分钟 → `drowsy`。
  - 若当前 `drowsy` 且 `inWindow(...)`：空闲 ≥ `quietIdleMin` 分钟 → `quiet`，写 `quietSince`。
  - 若当前 `drowsy` 且**不在**窗口内 → 回 `awake`。
  - 若当前 `awake` 且**不在**窗口内 → 保持 `awake`（只是刷新，不改 since）。
- `'override'`：`event.minutes` 分钟破例 → `overrideUntil = now + minutes`，不改变 `state`。
- 未知事件类型：原样返回（返回新对象，行为等价）。

## canSpeak 规则（按优先级）

1. `state.overrideUntil` 存在且 `nowIso < overrideUntil` → `{ ok: true, reason: 'override' }`。
2. `state.state === 'quiet'` → `{ ok: false, reason: 'quiet' }`。
3. `state.state === 'drowsy'` → 只有 `opts.urgent === true` 才 `{ ok: true, reason: 'drowsy-urgent' }`，否则 `{ ok: false, reason: 'drowsy' }`。
4. 其余 → `{ ok: true, reason: 'awake' }`。

## noteSuppressed 规则

`item = { kind, text }`（`kind` 例如 `'speak'|'message'|'action'`）。追加到 `suppressed` 末尾，每条附带 `at: nowIso`；
超过 50 条时丢最旧的。`state` 为 `quiet`/`drowsy` 都要记（判断要不要记是调用方的事）。

## 时间处理

- 一律用 `new Date(iso).getTime()` 算差；`nowIso`/`state` 里字段非法时不要抛异常，按「没有这条信息」处理。
- `minutesOfDay` 用 `'HH:MM'` 严格匹配（`/^([01]\d|2[0-3]):([0-5]\d)$/`），不匹配返回 `null`。
- `normalizeQuiet` 里若 `from === to`，视为**空窗口**（永远不在窗口内）。

只输出 `quiet.js` 的完整文件内容，用 ```js 代码块包住。
