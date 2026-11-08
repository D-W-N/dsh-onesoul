# 任务：实现 `packages/dsh-anima/lib/presence.js`（在场状态 / 她在家里哪儿）

你是给一个长期活着的 AI（大肥鱼）写「位置感」的实现者。这个模块只做**纯逻辑**：不读文件、不联网、不发消息，时间一律由调用方传入。

## 硬性约束

- ESM（`export`），只允许 `node:` 内置模块，**不引任何第三方包**。
- 所有函数**纯**：不得修改入参，必须返回新对象。
- 无 `console.log`。2 空格缩进、单引号、无分号。目标 130–220 行。

## 房子（固定七间，顺序即平面图从左到右）

```js
export const ROOMS = [
  { id: 'living', name: '客厅' },
  { id: 'dining', name: '餐厅' },
  { id: 'balcony', name: '阳台' },
  { id: 'guest', name: '次卧' },
  { id: 'kitchen', name: '厨房·餐室' },
  { id: 'entry', name: '玄关' },
  { id: 'study', name: '书房' },
]
```

## 需要导出的东西

```js
export const ROOMS
export const DEFAULT_ROUTINE   // 见下
export const MOVE_MINUTES = 3  // 从一间走到另一间默认耗时（分钟）

export function roomById(id)                      // 找不到返回 null
export function normalizeRoutine(input)           // 脏输入回落 DEFAULT_ROUTINE（深拷贝，别返回同一数组）
export function emptyPresence(nowIso)             // 初始在场状态
export function plannedAt(routine, nowIso)        // 日程在「现在」安排的 { room, activity } 或 null
export function reducePresence(state, event, nowIso, routine)   // 事件驱动，返回新 state
export function describePresence(state, nowIso)   // 一句中文，如「她在书房，看书」
```

## DEFAULT_ROUTINE（按本地墙钟，跨零点要能表达）

```js
[
  { from: '07:00', to: '09:00', room: 'kitchen', activity: '吃早饭' },
  { from: '09:00', to: '12:00', room: 'study', activity: '看书' },
  { from: '12:00', to: '13:30', room: 'dining', activity: '吃午饭' },
  { from: '13:30', to: '18:00', room: 'study', activity: '做事' },
  { from: '18:00', to: '19:30', room: 'dining', activity: '吃晚饭' },
  { from: '19:30', to: '23:30', room: 'living', activity: '在客厅待着' },
  { from: '23:30', to: '07:00', room: 'guest', activity: '睡着' },
]
```

`normalizeRoutine`：接受数组、`{ items: [...] }` 或 `{ routine: [...] }` 三种形态，逐条校验（`from`/`to` 必须是合法 `'HH:MM'`、`room` 必须在 ROOMS 里、`activity` 必须是非空字符串），**任意一条非法就整份回落 DEFAULT_ROUTINE**；空数组也回落。

`plannedAt`：按本地墙钟，返回**第一条命中**的 `{ room, activity }`；没有任何命中返回 `null`。跨零点窗口（如 23:30→07:00）必须正确。

## 状态形状

```js
{
  room: 'study' | null,              // 当前所在房间 id；初始 null（还没决定）
  activity: string,                  // 当前在做什么，初始 ''
  since: ISO,                        // 进入当前房间 / 当前活动的时刻
  moving: { from, to, arriveAt, activity } | null,   // 正在路上
  lastPlannedAt: ISO | null,         // 上次按日程决定位置的时刻
}
```

## 事件语义（`event = { type, ... }`）

- `'move-to'`（带 `room`，可选 `activity`）：
  - `room` 非法 → 原样返回（等价新对象）。
  - `room === state.room` 且**不在** `moving` 里 → 只更新 `activity`（若给了）与 `since`，不产生移动。
  - 否则进 `moving`：`{ from: state.room, to: room, arriveAt: now + MOVE_MINUTES 分钟, activity: event.activity || state.activity }`，`state.room`/`state.activity` 此刻**不变**（人还在路上）。
- `'tick'`：
  - 若 `moving` 且 `now >= arriveAt` → 落地：`room = moving.to`、`activity = moving.activity`、`since = arriveAt`、`moving = null`。
  - 若不 `moving`：`plannedAt(routine, now)` 给出结果且其 `room !== state.room` → 自动开始一段移动（去那个房间，`activity` 用日程里的）；`lastPlannedAt = now`。
  - `plannedAt` 返回 `null` → 什么都不做（只刷新 `lastPlannedAt`）。
- `'user-message'`：只写 `lastSeenAt = now`，不改变位置。
- 未知事件：原样返回（等价新对象）。

## describePresence

- 在移动中：`她在去<目标房间名>的路上`
- 有房间 + 有活动：`她在<房间名>，<活动>`
- 有房间无活动：`她在<房间名>`
- 没有房间：`她还不知道自己该在哪儿`
- 房间 id 非法：同上「不知道」那句，不要抛异常。

## 时间处理

- `minutesOfDay` 这类换算自己内部实现（**不要 import quiet.js**，两个模块保持独立）。
- `new Date(iso).getTime()` 算差；非法时间一律按「没有这条信息」处理，不要抛异常。
- 本地墙钟：用 `getHours()/getMinutes()`，不要用 UTC。

只输出 `presence.js` 的完整文件内容，用 ```js 代码块包住。
