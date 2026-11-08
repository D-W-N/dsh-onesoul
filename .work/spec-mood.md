# 任务：实现 `packages/dsh-anima/lib/mood.js`（心情评估）

你是给一个长期活着的 AI（大肥鱼）写「心情」的实现者。只用**词表 + 规则**，不许联网、不许调用任何模型、不许引第三方包。全部纯函数，时间由调用方传入。

## 硬性约束

- ESM，只允许 `node:` 内置模块；无 `console.log`；2 空格缩进、单引号、无分号；130–230 行。
- 所有函数纯：不改入参，返回新对象。
- 中文关键词一律用简体；词表放模块顶部常量，便于以后扩。

## 需要导出的东西

```js
export const MOOD_LABELS = ['很好', '不错', '平静', '低落', '很差']
export const BASELINE = { valence: 0.1, arousal: 0.35 }   // 她平时的底色：略偏正向、比较安静

export function emptyMood(nowIso)                 // 初始心情 = BASELINE 的拷贝 + since/lastAt
export function analyzeMessage(text, opts)        // 单条文本的即时信号
export function reduceMood(state, event, nowIso)  // 事件驱动（含时间衰减），返回新 state
export function valenceLabel(valence)             // 数值 → MOOD_LABELS 里的一个词
export function describeMood(state, nowIso)       // 一句中文，带理由
export function suggestMusic(state, nowIso)       // { tag, why } —— 放什么歌、为什么
```

## analyzeMessage 的语义

输入 `text`（字符串，脏输入按空串处理），可选 `opts = { repeatCount }`（同一负面线索重复次数，默认 1）。

- 词表分三类，各自带权重：
  - `POSITIVE`（如 开心、喜欢、谢谢、好棒、抱抱、想你、太好了、嘿嘿、哈哈）→ 拉高效价
  - `NEGATIVE`（如 累、烦、难过、生气、讨厌、失望、疼、加班、崩溃、不想说话）→ 拉低效价、抬唤醒
  - `CALM`（如 睡、安静、慢慢、没事、还好）→ 降唤醒
- **否定前缀要处理**：`不`、`没`、`别`、`不太` 紧挨在词前（中间不隔标点，最多 2 个字间隔）时，正向词转负、负向词转正。`不开心` 必须判负。
- 感叹/问号：`!`、`！`、`?`、`？` 出现越多，唤醒越高（有上限，别爆表）。
- 返回 `{ valence, arousal, hits }`：`valence ∈ [-1,1]`、`arousal ∈ [0,1]`，`hits = [{ word, kind, weight }]`（`kind` 是 `'positive'|'negative'|'calm'`）按出现顺序。没有任何命中时返回 `{ valence: 0, arousal: 0, hits: [] }`。
- `repeatCount > 1` 时负面线索的幅度按 `Math.min(repeatCount, 3)` 放大（最多 3 倍），**不要**让它超出 `-1`。

## reduceMood 的事件

```js
{ type: 'message', text, latencyMin? }   // 主人发来一句话
{ type: 'reply', text }                  // 她自己说了什么（只做轻微影响）
{ type: 'tick' }                         // 时间流逝：向 BASELINE 衰减
{ type: 'goodnight' } / { type: 'goodmorning' }
```

状态形状：

```js
{ valence, arousal, since, lastAt, lastReason, topHits: [] }
```

- `'message'`：`signal = analyzeMessage(text, { repeatCount: 1 })`；新值 = `clamp(prev * 0.7 + signal * 0.6 + BASELINE * 0.15)`（效价与唤醒各算一次，唤醒只吃正的 signal）。`latencyMin`（距上一条消息的分钟数）**大于 30** 时，唤醒额外 -0.05（久不联系，气氛冷下来）；`lastReason` 写成人话，例如 `因为你说到「累」`（取命中里绝对值最大的那个词，没有就说 `没什么特别的话`）。
- `'reply'`：只把唤醒向 `BASELINE.arousal` 收一点（乘 0.9 再补 0.1），不碰效价。
- `'tick'`：每分钟向 `BASELINE` 靠 `3%`，**必须**用 `nowIso` 与 `state.lastAt` 的分钟差算，差为 0 或非法则不动；最多一次靠拢不超过 0.5（防长时间不调用后突然跳变）。
- `'goodnight'`：效价小幅 +0.05（睡前的温柔），唤醒直接压到 0.15。
- `'goodmorning'`：唤醒抬到 `BASELINE.arousal + 0.05`，效价不动。
- 未知事件：原样返回（等价新对象）。

## valenceLabel

`>= 0.5` → `'很好'`；`>= 0.15` → `'不错'`；`> -0.15` → `'平静'`；`> -0.5` → `'低落'`；否则 `'很差'`。非数字按 `0` 处理。

## describeMood

`她心情<label>，<唤醒描述>——<lastReason>`。唤醒描述：`>= 0.7` → `心跳有点快`；`>= 0.45` → `还算有精神`；否则 `感觉很安静`。
例：`她心情不错，还算有精神——因为你说到「好棒」`。`lastReason` 为空时结尾用 `最近没什么特别的话`。

## suggestMusic

按四象限给 `{ tag, why }`：

| 条件 | tag | why 里要出现的关键词 |
|---|---|---|
| 效价 < -0.15 且 唤醒 >= 0.5 | `'宣泄'` | 需要一点响的 |
| 效价 < -0.15 且 唤醒 < 0.5 | `'安静'` | 不想吵 |
| 效价 >= 0.3 且 唤醒 >= 0.5 | `'轻快'` | 高兴 |
| 效价 >= 0.3 且 唤醒 < 0.5 | `'温暖'` | 慢一点 |
| 其余 | `'日常'` | 平常 |

`why` 要是完整中文句子，例如 `她这会儿需要一点响的，先把情绪放出去`。
