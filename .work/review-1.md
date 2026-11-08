## 1. 运行时异常

- [P0] lib/index.js:apply 内的 state 初始化 — 新代码在构造 state 时调用 `nowIso()`，但这份 diff 没有改动 store 的 import 行，而原代码只用到 `stampOf`、`readJsonSync`；如果 `nowIso` 从来没被导入，`apply()` 一进入就会直接抛 ReferenceError，导致插件整体加载失败 — 确认 `nowIso` 确实在 `from './store.js'` 的导入列表中，没有就补上（同时核对 `writeJson`、`stampOf`、`readJsonSync` 是否同源）。
- [P1] lib/index.js:anima_presence_move / anima_mood_note 的返回值 — `describePresence(state.runtime.presence, …)` / `describeMood(state.runtime.mood)`：当 `normalizeRuntime(null)`（首次启动或读盘 fallback）产出的对象缺少 presence/mood 字段时，helper 内部解构是会抛异常的；此时写盘已经成功，但工具报错，调用方会以为失败并重试 — 在返回摘要前判空，或让这两个 helper 接受 undefined。
- [P1] lib/index.js:anima_quiet 的 execute — 未校验 `applyRuntimeEvent` 的返回值：如果它传入未知 type 时返回 undefined，`state.runtime` 就会被赋成 undefined，下一轮同步提示词路径的 `summarizeRuntime(state.runtime, …)` 直接抛，被外层 catch 吞成“人设读取失败”，连人设、记忆、日程一起消失；而且 undefined 还会被 persistRuntime 写入磁盘 — 先做事件类型校验，返回值非对象时不赋值、不写盘。
- [P1] lib/index.js:anima_state_get 的 execute — `JSON.stringify(state.runtime, null, 2)` 在 runtime 为 undefined 时返回 undefined，与 `output.schema.type: 'string'` 不符，输出校验会抛；且 summarize 抛错时整个工具失败 — 先判空，再统一 `String(...)`。
- [P2] lib/index.js:提示词注入拼接 — `summarizeRuntime` 在安静或无状态时返回空串仍拼 `'\n\n'`，每轮系统提示尾部多出空段 — 拼接前判空。

## 2. stamp 抖动 / 写盘被热加载覆盖

- [P0] lib/index.js:persistRuntime 与 refreshSync 交替 — `persistRuntime` 先把 `runtimeStamp` 置成 `'writing'` 再 `await writeJson`，而 `refreshSync` 是同步提示词路径、不在 `serialize` 链上，await 期间它必然看到“磁盘 stamp ≠ 'writing'”而重读：要么读到半写文件（parse 失败 → fallback null → runtime 被重置为空），要么读到旧内容（把刚 apply 到内存的事件覆盖掉）。写完后 stamp 与磁盘一致，内存却是旧/空值，下一次任意 `persistRuntime` 把它整份写回 → 丢事件或清状态。这是真实的数据丢失路径，不只是性能问题 — `refreshSync` 遇到 `'writing'` 直接 return（或用独立 pending 标志），写入走临时文件 + rename 原子替换，写完重新 normalize 一次。
- [P1] lib/index.js:persistRuntime — 没有 try/catch：`writeJson` 抛错时 `runtimeStamp` 永久停在 `'writing'`，此后每轮 `refreshSync` 都重读磁盘（就是你说的“每轮都重读”），内存里的事件被静默丢弃但工具已返回成功；若 `serialize` 实现是 `chain = chain.then(task)` 而无 catch，这一条 rejection 会让后续所有串行任务（包括人设/记忆写盘）全部失败 — 用 try/finally 保证 stamp 必被重算，失败时回滚 `state.runtime` 并向上抛；确认 serialize 在 reject 后能恢复链。
- [P1] lib/index.js:工具执行前不 refreshSync — 外部（dashboard/HTTP 路由）改了 runtime 文件后，工具直接拿旧内存 apply 再整份覆盖写回，外部修改丢失 — 工具进入 serialize 后先 refreshSync（或 persist 前比对 stamp，不一致就先合并）。
- [P2] lib/index.js:runtimeStamp 的取值 — 若 `stampOf` 只取 mtime，同一毫秒内的两次写入会让 stamp 不变，内存与磁盘静默不一致，热加载失效 — stamp 带上 size 或内容版本号。
- [P2] lib/index.js:init 的 `runtimeStamp: ''` + `normalizeRuntime(null, nowIso())` — 首轮 refresh 必然触发一次不必要的读盘与对象重建（无害但可省）— 初始化后直接取一次 `stampOf(runtimePath())`。

## 3. 工具参数校验

- [P1] lib/index.js:anima_quiet — `action` 无枚举校验，任意字符串（含拼写错误）透传给 `applyRuntimeEvent`；`override` 不传 `minutes` 时若内部做 `now + minutes*60000` 会得到 NaN → 写出 Invalid Date 字符串，之后 `normalizeRuntime` 读回可能抛或把说话门永久卡死 — 按 action 分支校验（白名单），`minutes` 给默认值兜底，写盘前校验生成的时间戳有效。
- [P1] lib/index.js:anima_quiet / anima_presence_move — `minutes` 没有最小值、上限、整数校验：负数会把门/在场时间“倒拨”，超大值等于永久静默或永久 override；schema 的 `type: 'number'` 不阻止字符串数字与 NaN 进来 — 加 `minimum: 0`（或 1）、`maximum`，并显式 `Number.isFinite` 校验。
- [P2] lib/index.js:anima_presence_move — `room` 是自由文本，没有已知房间表校验，可以把在场写进根本不存在的房间，之后 `describePresence`/摘要会回显一个幽灵地点 — 用房间注册表校验，或至少 trim、拒绝空串、限制长度。
- [P2] lib/index.js:anima_mood_note — `text` 无长度上限，直接进心情事件并每轮进提示词，一次调用就能灌爆上下文与磁盘 — 截断 + 事件条数上限。
- [P2] lib/index.js:anima_quiet — `kind` 是自由字符串，作为类型标记写进状态并可能被 summarize 回显到系统提示 — 限定取值或转义。

## 4. 性能与正确性

- [P1] lib/index.js:runtime 结构 + 提示词注入 — 心情/事件历史无上限，而 `summarizeRuntime` 每轮都进系统提示：上下文和磁盘无界增长，每轮 O(n) — 保留最近 N 条或按时间窗裁剪，摘要只渲染聚合结果并将总长度封顶。
- [P2] lib/index.js:anima_state_get — 不经过 `serialize`、也不 refreshSync：读到的是可能过期甚至被并发写覆盖前的内存快照，且把含全部历史的 runtime 整份 `JSON.stringify` 返回，输出 token 不可控 — 先同步刷新，只返回摘要 + 有界字段，过滤内部时间戳/事件 id。
- [P2] lib/index.js:persistRuntime 的写盘路径 — 需确认 `runtimePath()` 落在 animaDir 下的用户数据目录，而不是插件包目录或被 git 跟踪的位置；若写在安装目录，升级即丢且会污染仓库 — 固定到用户数据目录，并确保目录存在（必要时 mkdir）。
- [P2] lib/index.js:提示词注入 — runtime 摘要在安静、无状态时也整段塞进系统提示，且无长度上限，与 persona/memory 一样被 `applies` 门控但自身不做节流 — 摘要输出控制在固定行数内。