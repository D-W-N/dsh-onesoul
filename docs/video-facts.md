# 宣传片用事实清单 · dsh-onesoul

> 用途：57 秒产品片里，除用户给定的逐字脚本外，所有「UI 文字 / 日志行 / JSON 字段 / 终端输出 / 房间名 / Tab 名」的权威来源。
> 方法：只读仓库现有文件（`git ls-files` / grep / 读源码），证据一律写 `相对路径:行号` 或贴出原始命中行。
> 结论标注：**【实测】**=源码里能直接读到 / **【文档】**=仅在 docs 里出现、未在源码复现 / **【未证实】**=找不到证据。
> 本文件是唯一新增文件，仓库既有文件未做任何修改。

---

## 1. 安装命令与发布包名

**【实测】唯一真实的安装形态（带 `--profile`）：**

```bash
dsh plugin add --profile web dsh-onesoul
```
证据：`README.md:7`（原文行 `dsh plugin add --profile web dsh-onesoul`）、`packages/dsh-onesoul/README.md:9`、`docs/PUBLISH.md:17`。

**【实测】桌面版要换 profile 名：**
> `（桌面版把 `--profile web` 换成 `--profile desktop`。）` —— `packages/dsh-onesoul/README.md:12`

**【实测】但 `--profile desktop` 实际会被 CLI 拒绝：**
> `desktop profile 由 Electron 独占管理，`dsh plugin add --profile desktop` 会被拒绝；桌面用户需要按 docs/VERIFICATION.md §7.2 的 pnpm 方式安装，或把日常 profile 切到 web。`
> —— `docs/PUBLISH.md:133-134`

**发布包身份（原样）：**

| 字段 | 值 | 证据 |
|---|---|---|
| name | `dsh-onesoul` | `packages/dsh-onesoul/package.json:2` |
| version | `0.2.6` | `packages/dsh-onesoul/package.json:3` |
| license | `MIT` | `packages/dsh-onesoul/package.json:58` |
| engines.dsh | `>=0.2.0-rc.2` | `packages/dsh-onesoul/package.json:31` |
| engines.node | `>=22.13.0` | `packages/dsh-onesoul/package.json:60` |
| description | `一个灵魂，多个通道：人格与长期记忆（anima）+ 控制中心仪表盘 + QQ / B站 / 表情包通道，一条 dsh plugin add 装齐。` | `packages/dsh-onesoul/package.json:4` |

**【实测】dependencies 原样（7 个上游包，版本号逐字）：**

```json
"dependencies": {
  "dsh-better-sidebar": "^0.26.1",
  "dsh-deepseek-web-login": "^1.0.3",
  "dsh-onebot-qq": "^0.9.9",
  "dsh-napcat-keeper": "^2.8.2",
  "dsh-bili-pond": "^1.3.14",
  "dsh-meme": "^0.1.71",
  "dsh-our-free-model": "^2.1.0"
}
```
证据：`packages/dsh-onesoul/package.json:34-42`。`files` 里含 `lib/`、`plugins/`、`cordis.patch.yml`、`README.md`、`LICENSE`（`:7-13`）。

**【实测】内置（不是依赖）的两个子插件：** 灵魂 `anima` 与控制中心 `dashboard` 由构建脚本复制进 `plugins/`，`lib/index.js` 用 `ctx.plugin()` 各挂一个 fiber —— `packages/dsh-onesoul/lib/index.js:12-13,23-24`。

**装配清单实际插入了 9 行**（`packages/dsh-onesoul/cordis.patch.yml`）：
`better-sidebar`(15) / `dsh-deepseek-web-login`(20) / `dsh-onebot`(24) / `onebot-settings-remote`(26) / `napcat-keeper`(28) / `bili-pond`(33) / `dsh-expression`(38) / `our-free-model`(41) / `dsh-onesoul`(46)。

**【实测】默认模型（可上画面的真实值）：** `provider: deepseek-web` / `model: deepseek-reasoner` —— `packages/dsh-onesoul/cordis.patch.yml:73-74`。

---

## 2. 控制中心：Tab、总览分区、房间、心情、服务状态、最近对话

### 2.1 侧边栏 Tab 真名

**【实测】Tab 标题就是「控制中心」四个字：**

```js
service.registerTab({
  id: 'companion:control-center',
  title: '控制中心',
  description: '人格、待审记忆与各通道状态，一个 Tab 看住',
  order: 5,
  single: true,
```
证据：`packages/dsh-companion-dashboard/lib/client.js:1904-1910`（title 在 `:1906`）。

**【实测】Tab 内部导航按钮（顺序即渲染顺序）：**
`总览` / `对话` / `记忆` / `QQ` / `B站` / `表情包` / `模型`
证据：`client.js:1856-1858`（`[{ id: 'home', title: '总览' }, { id: 'chat', title: '对话' }]` + 四通道 + `{ id: 'model', title: '模型' }`）；四通道中文名逐字见 `client.js:1854`。

> 注：`记忆` 按钮后面会拼上待审条数（`item.title + ' ' + pending`）—— `client.js:1864`。

### 2.2 总览页（home）真实分区标题

原样字符串（kicker，大写英文，可直接作画面小标题）：

| 分区 | 原样文案 | 证据 |
|---|---|---|
| 位置/在场 | `HOME / LIVE` | `client.js:1598` |
| 房间内状态 | `INDOOR` | `client.js:1612` |
| 服务状态 | `SYSTEM`（右侧注 `点一行进对应页`） | `client.js:1626` |
| 说话/耳朵 | `MY HEAR` | `client.js:1643` |
| 记忆 | `MEMORY`（右侧注 `N 条已确认`） | `client.js:1681` |
| 对话 | `QQ / OWNER`（右侧 `LIVE` / `OFF-LINE`） | `client.js:1702` |

**卡片中文标题：** `让她说一句`（`client.js:1644`）、`温记忆`（`client.js:1682`）、`最近的对话`（`client.js:1703`）。

**状态数字标签：** `已确认` / `待裁决` / `已拒绝` —— `client.js:1685-1687`。
**记忆卡说明句：** `记忆按「她说过的、我判过的」落成卡片，只把索引放进她的提示词。` —— `client.js:1683`。
**生效范围两个按钮：** `全局` / `仅 Onesoul` —— `client.js:1692-1693`。
**页脚原样串：** `'dsh-onesoul · 总览 · ' + N + ' 条对话 · ' + ('耳朵在听'|'耳朵关着')` —— `client.js:1724`；右侧 `'说话门：' + (醒着|半睡|静默中) + ' · QQ ' + (在线|离线)` —— `client.js:1725`。

### 2.3 房间名称集合

**【实测】7 个房间（灵魂层定义）：**

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
证据：`packages/dsh-anima/lib/presence.js:1-9`。

**【实测】控制中心总览平面图上的房间名（注意与灵魂层有一处不一致）：**
`{ living: '客厅', dining: '餐厅', balcony: '阳台', study: '书房', guest: '次卧', kitchen: '厨房', entry: '玄关' }`
证据：`client.js:1372`（kitchen 在这里是 `厨房`，不是 `厨房·餐室`）。

**【实测】每个房间的默认活动词（画面很出效果）：**
`{ living: '窝着', dining: '吃饭', balcony: '晒太阳', study: '看书', guest: '躺着', kitchen: '做饭', entry: '换鞋' }` —— `client.js:1373`。

**【实测】平面图格子布局（7 格网格坐标）：** `client.js:1374-1382`。

**【实测】默认日程表（时间 → 房间 → 活动）：**
`07:00-09:00 kitchen 吃早饭` / `09:00-12:00 study 看书` / `12:00-13:30 dining 吃午饭` / `13:30-18:00 study 做事` / `18:00-19:30 dining 吃晚饭` / `19:30-23:30 living 在客厅待着` / `23:30-07:00 guest 睡着` —— `presence.js:16-24`。

**【实测】位置文案模板：** `她在${room.name}` / `她在${room.name}，${state.activity}` / `她在去${target.name}的路上` —— `presence.js:355,358,346`。
总览大标题：`她在客厅` / `她去了阳台` / `她还没定住在哪` —— `client.js:1587`（模板 `'她去了' + where` / `'她在' + where` / `'她还没定住在哪'`）。
三个统计项 key：`房间` / `状态` / `回来` —— `client.js:1616-1618`。

### 2.4 心情字段

**【实测】5 档心情标签（enum）：** `['很好', '不错', '平静', '低落', '很差']` —— `packages/dsh-anima/lib/mood.js:2`。
**【实测】数值字段名：** `valence`（连续值 -1..1）、`arousal`（0..1）、`since`、`lastAt`、`lastReason`、`topHits` —— `mood.js:117-127`；基线 `{ valence: 0.1, arousal: 0.35 }` —— `mood.js:3`。
**【实测】心情描述句模板：** ``她心情${label}，${arousalDesc}${reason}`` —— `mood.js:241`；`arousalDesc` 取值 `心跳有点快` / `还算有精神` / `感觉很安静` —— `mood.js:233,235,237`；`reason` 缺省 `——最近没什么特别的话` —— `mood.js:240`。
**【实测】总览卡上的写法：** `此刻心情：${mood.label}`，空则 `此刻安静` —— `client.js:1671`。
**【实测】runtime 接口返回的字段名：** `moodLabel: valenceLabel(...)` —— `packages/dsh-anima/lib/index.js:1470`。

### 2.5 服务在线状态（逐项真名 + 状态词）

**【实测】9 行服务，名字逐字：**

| 服务名（原样） | 数据来源 | 证据 |
|---|---|---|
| `QQ 桥接` | `qq.onebot.clients > 0` | `client.js:1574` |
| `QQ 客户端` | `qq.procs.boot > 0` | `client.js:1575` |
| `人格 anima` | `services.anima.installed` | `client.js:1576` |
| `耳朵 · 小爱` | `ears.on` | `client.js:1577` |
| `B站` | `services.bili.installed` | `client.js:1578` |
| `表情包` | `services.meme.installed` | `client.js:1579` |
| `侧面栏` | `services.sidebar.installed` | `client.js:1580` |
| `对话记录` | `chatRows.length > 0`（右侧注 `N 条`） | `client.js:1581` |
| `模型链路` | `!!chainCount`（右侧注 `N 条` / `未排`） | `client.js:1582` |

**【实测】状态词只有两个：** `ON-LINE` / `OFF-LINE` —— `client.js:1628`（`const st = item.on ? 'ON-LINE' : 'OFF-LINE'`）。

### 2.6 最近的对话

**【实测】标题 `最近的对话`（`client.js:1703`）**，数据源 `GET /anima/api/recent-chat?limit=8`（`client.js:1418`），只展示最近 7 条（`chatRows.slice(0, 7)` —— `client.js:1705`）。
**【实测】空态文案：** `还没有对话。QQ 或小爱聊过之后，这里会出现最近几条。` —— `client.js:1714`。
**【实测】页脚注：** `'最新 ' + n + ' 条 / QQ 与小爱'` —— `client.js:1716`。
**【实测】每行三个字段：** 时间 `HH:MM`、说话人（`她` / 通道名）、正文 —— `client.js:1710-1712`。
**【实测】通道名 enum（原样）：** `['控制中心', 'QQ', 'B站', '小爱', '桌面']` —— `packages/dsh-anima/lib/index.js:813`；映射规则见 `:802-810`。
**【实测】存储：** `<DSH_HOME>/anima/recent-chat.json`，上限 `RECENT_CHAT_CAP = 40` 条 —— `index.js:787,790`。

---

## 3. anima 工具：真名、参数名、记忆 id 前缀

**【实测】注册的工具全名单（19 个，逐字）：**
`anima_status`(299) · `anima_persona_get`(309) · `anima_persona_set`(324) · `anima_memory_capture`(361) · `anima_memory_pending`(404) · `anima_memory_decide`(420) · `anima_memory_get`(450) · `anima_memory_revoke`(468) · `anima_memory_audit`(491) · `anima_ephemeral_get`(510) · `anima_ephemeral_refresh`(534) · `anima_memory_search`(547) · `anima_memory_import`(573) · `anima_state_get`(611) · `anima_presence_move`(622) · `anima_mood_note`(648) · `anima_quiet`(667) · `anima_speak`(697) · `xiaomi_say`(726)
证据：`packages/dsh-anima/lib/index.js` 对应行（`name:` 字段）。

### 3.1 `anima_memory_capture` 参数（原样）

```js
parameters: {
  text: { type: 'string', required: true, description: '一条独立、可复核的事实或偏好，第三人称陈述' },
  tags: { type: 'array', items: { type: 'string' }, description: '标签，如 偏好/关系/项目/雷区' },
  source: { type: 'string', description: '来源，如 dsh-session / qq / bili / import' },
  evidence: { type: 'string', description: '证据：在哪儿看到的、原文或链接。留空会被标成证据不足、进隔离区。' },
  derivedFrom: { type: 'array', items: { type: 'string' }, description: '由哪几条记忆推出来的（记忆 id）…' },
}
```
证据：`index.js:363-369`。

**【实测】返回串（原样模板）：** `'已进入候选池（待审 ' + pending + ' 条）：' + entry.id + '\n' + entry.text + tail + '\n裁决通过后才会进入长期记忆。'` —— `index.js:398`。
**【实测】** 无 evidence 时追加：`\n注意：这条没有证据，已标成「证据不足」进隔离区，裁决前请先补证据。` —— `index.js:397`。
**【实测】默认 source：** `'dsh-session'` —— `index.js:381`；写盘时 `status: 'candidate'`、`scope: 'global'` —— `index.js:382-383`。

### 3.2 `anima_memory_pending` 参数

`{ limit: { type: 'number', description: '最多返回条数，默认 20' } }` —— `index.js:406`。
**【实测】空态串：** `没有待审候选记忆。` —— `index.js:412`。
**【实测】** 返回 JSON 字段：`id` / `text` / `tags` / `source` / `createdAt` / `evidence` / `quarantine` —— `index.js:414`。

### 3.3 `anima_memory_decide` 参数（原样，注意是 `id` + `decision`）

```js
parameters: {
  id: { type: 'string', required: true, description: '候选记忆 id，可用 "latest" 表示最新一条' },
  decision: { type: 'string', required: true, description: 'approve 或 reject' },
  note: { type: 'string', description: '裁决备注' },
}
```
证据：`index.js:422-426`。
**【实测】成功串：** `'已通过并写入长期记忆：' + id` / `'已拒绝并丢弃：' + id` —— `index.js:444`。
**【实测】校验串：** `decision 必须是 approve 或 reject。` —— `index.js:432`。
**【实测】描述原文：** `对一条候选记忆做裁决：approve 写入长期记忆并注入所有人格通道；reject 丢弃并留痕。裁决权属于用户，模型不得自行 approve。` —— `index.js:421`。

> ⚠️ 名字差异提醒：**工具**里是 `decision`；**HTTP 路由** `/anima/api/decide` 也是 `decision`（`index.js:1566`），但 `packages/dsh-anima/README.md:39` 里写成 `verdict: 'approve' | 'reject'` —— **README 这里是过期的**，以实现为准（`decision`）。
> 另：**控制中心前端**调 `/decide` 传的也是 `decision`（`client.js:368`）。

### 3.4 记忆 id 前缀

**【实测】生成规则：** `prefix + '_' + Date.now().toString(36) + '_' + randomUUID().slice(0, 8)` —— `packages/dsh-anima/lib/store.js:27-29`。
**【实测】记忆用 `newId('mem')`** —— `index.js:378,593,1588`。所以真实 id 形如 `mem_mvquxh77_36411625`（文档里的实测样例：`docs/FEASIBILITY.md:24`、`docs/VERIFICATION.md:314`）。
**【实测】工具描述里的说法：** `记忆 id，形如 mem_xxx（见系统提示的索引行）` —— `index.js:453`。
> 即分镜写 `mem_xxx` 作占位**是对的**；但真机上 id 是 `mem_<base36时间戳>_<8位hex>`，占位符不能当真实样例一字不差地用。

### 3.5 候选池确实不进系统提示词（可作画面断言）

**【实测】注入函数只取 approved：** `const approved = approvedMemories(memory, cwd, 200)` —— `packages/dsh-anima/lib/model.js:223`。
**【实测】代码注释原文：** `Candidate memory is never listed here — it is not a fact until the user rules on it.` —— `model.js:201`。
**【实测】索引行格式：** `'- [' + entry.id + '] ' + brief + tags`，摘要截断 `INDEX_BRIEF_MAX = 42`，标签用 `（tag1/tag2）` —— `model.js:130,133-138`。
**【实测】候选区标题：** `## 待用户裁决的候选记忆（N 条）` + `以下内容尚未获得用户确认，不得当作已知事实使用；用户裁决通过后会进入上面的长期记忆。` —— `model.js:240-241`。
**【实测】索引区标题：** `## 已确认的长期记忆（索引）` —— `model.js:225`。
**【实测】冒烟测试也在断言这条：** `assert.ok(!before.includes('- 用户讨厌被叫'), '候选不得进入已确认记忆区')` —— `scripts/smoke.mjs:127`。

> ✅ 分镜注释「候选池，进不了提示词」**与实现一致**（候选正文不进；但候选的**标题与条数**会出现，见 `model.js:240`）。

### 3.6 `anima_speak` / `xiaomi_say` 参数

```js
// anima_speak
text:   { type: 'string', required: true, description: '要说的话' }
force:  { type: 'boolean', description: '说话门关着也照说；仅当用户明确要她现在就开口时用' }
play:   { type: 'boolean', description: '是否当场放出来；false 只生成音频文件' }
engine: { type: 'string', description: '强制引擎 baidu / youdao / sapi；省略按顺序自动挑' }
```
证据：`index.js:700-703`。
> 注意 `engine` 的**描述里只列了 baidu / youdao / sapi**，没列 `edge`；但 `voice.js:143` 的注释里 `edge` 是可用值（且是首选）。分镜若要出现 `engine` 值，用 `baidu`/`youdao`/`sapi` 最稳。

```js
// xiaomi_say
text:   { type: 'string', required: true, description: '要说的话' }
device: { type: 'string', description: '音箱名或 deviceID 前缀；省略用第一台' }
force:  { type: 'boolean', description: '说话门关着也照说；仅当用户明确要她现在就开口时用' }
```
证据：`index.js:729-731`。工具描述原文：`让小爱音箱替 anima 说话：先合成她自己的声音，再把音频挂到局域网让音箱来拉取播放。` —— `index.js:727`。

**【实测】`anima_speak` 成功返回串：** `'已开口（' + engine + '，' + NKB + 'KB）：' + path` —— `index.js:722`。
**【实测】说话门关着时：** `'现在说不了话（' + gate.reason + '），这句先替你攒着。要立刻开口就带 force: true。'` —— `index.js:718`。

---

## 4. 「耳朵」：日志格式、回合名、触发条件

### 4.1 日志行格式（逐字，可直接上画面）

```js
ctx.logger.info('dsh-anima: 耳朵收到 ' + fresh.length + ' 条；reply=' + ears.reply + '；判定=' + marks.join(','))
```
证据：`packages/dsh-anima/lib/index.js:1326`。

**【实测】`判定` 的构造：**
```js
const marks = fresh.map(function (item) {
  const txt = String(item.row.answer || '')
  return (calledHer(item.row.question) ? '点名' : '') + (looksStuck(txt) ? '答不上' : '正常')
})
```
证据：`index.js:1322-1325`。

**【实测】`判定` 的取值全集（只有 4 种，无其它）：**
| 取值 | 含义 |
|---|---|
| `正常` | 小爱答了，且答上来了 |
| `答不上` | 小爱答不上来 |
| `点名正常` | 用户点名叫她，且小爱也答了 |
| `点名答不上` | 用户点名叫她，且小爱答不上来 |

**【实测】`reply=` 的取值：** `true` / `false`（`ears.reply` 是布尔，默认 `true` —— `index.js:1115`）。

> ✅ 分镜原句 `dsh-anima: 耳朵收到 1 条；reply=true；判定=答不上` **与真实日志同构**，可以直接用。
> ⚠️ 但要注意：真实行里 `判定=` 后面可能是**多条逗号拼接**（`marks.join(',')`），例如 `判定=正常,点名答不上`。

### 4.2 回合名前缀

**【实测】生成方式（逐字）：**
```js
sessionId: 'anima-ears-' + Date.now().toString(36),
```
证据：`index.js:1217`。即 `anima-ears-` + base36 时间戳，例如 `anima-ears-mvxduzds` 这类。
**【实测】文档说法：** ``（`anima-ears-<随机>`，复用同一个）`` —— `packages/dsh-anima/README.md:69`。
> 严格说不是「随机」，是 **base36 编码的 `Date.now()`**；而且这个回合**只创建一次后复用**（`if (!earsTurn)` —— `index.js:1208`）。

**【实测】另有同族但用途不同的回合名：**
- `anima-console-` + base36 —— 控制中心对话框（`index.js:1254`）
- `anima-` 前缀在通道归属上统一判为 `控制中心`（`index.js:808`），`anima-ears` 优先判为 `小爱`（`:807`）

### 4.3 触发条件

**【实测】判定为「要接话」的完整条件（代码原文）：**
```js
const isFresh = (Date.now() - Number(item.row.timestampMs || 0)) < 90000
const byName = calledHer(item.row.question)
const stuck = looksStuck(item.row.answer)
const willAnswer = ears.reply && isFresh && (byName || stuck)
```
证据：`index.js:1300-1303`。即 **reply 开 + 90 秒内的新话 + （点名 或 小爱答不上来）**。

**【实测】点名正则（她允许被这些词叫出来）：**
```js
const CALL_HER_RE = /(问问|问一下|问下|叫|召唤|呼叫|请教)\s*(阿音|音音|anima)/i
```
证据：`index.js:1175`。

**【实测】「答不上来」的三档正则：**
```js
const STUCK_STRONG = /(回答不上|需要再学习|还在学习|更努力学习|没听懂|不会这项技能|难住|问住|没找到.*(为你推荐其他|的新闻)|我.*(再|多|继续|努力)(学习|学学))/
const STUCK_END = /((我)?不会|不知道|不清楚|不懂|没办法)(啊|呀|哦|呢|的)?\s*[。．.!！~]*$/
const STUCK_WEAK = /(暂时)/
```
证据：`index.js:1160-1163`（`looksStuck` 在 `:1165-1172`）。

**【实测】轮询间隔：** 默认 `3000` ms，下限 `1500`（`Math.max(1500, ...)`）—— `index.js:1115,1342`。
**【实测】自动开启：** 有 `<DSH_HOME>/anima/mi.json` 就随路由挂载自动开 —— `index.js:1392-1400`；日志串 `'dsh-anima: 耳朵自动' + ('开启成功' | '开启失败（...）')` —— `:1396`。
**【实测】判定落盘文件：** `<DSH_HOME>/anima/ears-trace.log`，自限 256KB，空轮询不写 —— `index.js:1117-1126`；trace 行格式 `poll fresh=N reply=B delivered=N err=...`、`Q="..." A="..." age=Ns fresh=.. reply=.. byName=.. stuck=.. -> 接话|不接` —— `index.js:1295,1304-1308`。

---

## 5. 模型链 `model-chain.json`：真实 schema

**【实测】文件位置：** `<DSH_HOME>/anima/model-chain.json` —— `packages/dsh-companion-dashboard/lib/index.js:448-450`。

**【实测】真实 schema（读入归一化，逐字）：**
```js
return {
  chain: chain,                                                    // [{ provider, model, reasoningEffort? }]
  onFail: { advance: onFail.advance !== false, restart: onFail.restart !== false },
  lastFailAt: typeof src.lastFailAt === 'string' ? src.lastFailAt : '',
  lastFailNote: typeof src.lastFailNote === 'string' ? src.lastFailNote : '',
}
```
证据：`packages/dsh-companion-dashboard/lib/index.js:461-466`。

**【实测】`chain` 元素过滤与投影（只有这三个键）：**
```js
const chain = Array.isArray(src.chain) ? src.chain.filter(function (item) {
  return item && typeof item.provider === 'string' && typeof item.model === 'string'
}).map(function (item) {
  return { provider: item.provider, model: item.model, ...(item.reasoningEffort ? { reasoningEffort: item.reasoningEffort } : {}) }
}) : []
```
证据：`index.js:455-459`。

**【实测】完整文件形态（按 `writeModelChain` 的 `JSON.stringify(next, null, 2)` 推，`index.js:472`）：**
```json
{
  "chain": [
    { "provider": "deepseek-web", "model": "deepseek-reasoner" }
  ],
  "onFail": { "advance": true, "restart": true },
  "lastFailAt": "",
  "lastFailNote": ""
}
```
（`chain` 的默认内容来自用户自己配的链，仓库里没有硬编码样例；上面用部署默认模型 `deepseek-web/deepseek-reasoner` 填 —— `cordis.patch.yml:73-74`。）

**【实测】`onFail.advance` / `onFail.restart` 的语义（代码注释 + 逻辑）：**
- `advance`：`失败自动切换`，只订阅 `turn/end` 且 `reason.kind === 'error'` 时沿链下移一格；**3 分钟冷却** `FAIL_COOLDOWN_MS = 180000` —— `index.js:494-496,516-524`。
- `restart`：切完之后 `1500` ms 顺手重启宿主 —— `index.js:550-555`。
- 链尾无可切项时写：`lastFailNote = provider + ' / ' + model + ' 报错，但已在链尾，没有可切的下一条'` —— `index.js:533`。
- 切换时写：`lastFailNote = provider + ' / ' + model + ' 报错 → 切到 ' + next.provider + ' / ' + next.model` —— `index.js:537`。
- 日志串：`'dsh-onesoul: ' + note` / `'dsh-onesoul: 模型报错，链尾无可切项'` —— `index.js:534,545`。

**【实测】控制中心「模型」分支上的相关按钮文案（原样）：**
`优先顺序 · 失败自动切下一条`（`client.js:1204`）、`自动切换：开` / `自动切换：关`（`:1239`）、`切完自动重启：开` / `切完自动重启：关`（`:1240`）、`把当前默认加进来`（`:1238`）、`重启 DSH`（`:1242`）、`当前默认模型`（`:1321`）。

### 5.1 `buddy` / `hy4free` / `hy3` —— **不存在**

**【实测】全仓库 grep `hy4free|hy3|buddy` = 0 命中**（范围：`packages/`，58 个受检文件，`matchedTotal=0`）。

真实存在的 provider / model 名（有证据的）：

| 名字 | 类型 | 证据 |
|---|---|---|
| `deepseek-web` | provider 路由 | `cordis.patch.yml:73`；`docs/STATUS.md:47` |
| `deepseek-reasoner` | model | `cordis.patch.yml:74` |
| `deepseek-chat` | model | `docs/VERIFICATION.md:493` |
| `deepseek-official` | provider | `docs/VERIFICATION.md:491` |
| `deepseek-flash` / `deepseek-v4-pro` | model | `docs/VERIFICATION.md:491` |
| `our-free-model` | provider | `docs/VERIFICATION.md:548` |
| `combo:free` | model（命名降级链） | `docs/VERIFICATION.md:546,548` |
| `flint-40b-free` / `beam-free` | model | `docs/VERIFICATION.md:545` |

> ❌ 分镜里的 `{ "provider": "buddy", "model": "hy4free" }` / `{ "provider": "buddy", "model": "hy3" }` **是编的**。`buddy` 这个 provider 在本仓库任何文件里都不存在。
> ✅ 建议改成真实的两条线路，例如 `deepseek-web / deepseek-reasoner` + `our-free-model / combo:free`，`onFail` 那半段（`advance` / `restart`）**完全真实**，可以原样保留。

---

## 6. 语音：TTS 引擎、音色、小爱播放路径

### 6.1 引擎链（按顺序降级，逐字）

```js
const chain = [
  ['edge', viaEdge],
  ['baidu', viaBaidu],
  ['youdao', viaYoudao],
  ['sapi', viaSapi],
]
```
证据：`packages/dsh-anima/lib/voice.js:153-158`。
**【实测】注释原文：**
```
1. edge    微软 Edge 朗读，音质最好、起伏自然（首选）
2. baidu   百度翻译的公开朗读接口，整句都能读，质量够用（备用）
3. youdao  有道词音，短句备用（长句会被它拒成 500）
4. sapi    Windows 自带 Huihui，离线，音色机械但永远可用
```
—— `voice.js:3-6`。

### 6.2 音色（`zh-CN-XiaoxiaoNeural` 真实存在，且是默认）

```js
export const VOICES = {
  xiaoxiao: 'zh-CN-XiaoxiaoNeural',
  xiaoyi:   'zh-CN-XiaoyiNeural',
  yunxi:    'zh-CN-YunxiNeural',
  yunjian:  'zh-CN-YunjianNeural',
  xiaobei:  'zh-CN-liaoning-XiaobeiNeural',
  xiaoni:   'zh-CN-shaanxi-XiaoniNeural',
  hiuMaan:  'zh-HK-HiuMaanNeural',
  hsiaochen:'zh-TW-HsiaoChenNeural',
}
export const DEFAULT_VOICE = VOICES.xiaoxiao
```
证据：`packages/dsh-anima/lib/edge-tts.js:14-24`。注释原文：`常用中文音色。她默认用晓晓：语气起伏最自然…` —— `:13`。
**【实测】环境变量可覆盖：** `process.env.ANIMA_VOICE` —— `voice.js:51`。
**【实测】engine 字符串：** 合成结果里是 `'edge:' + voice`（如 `edge:zh-CN-XiaoxiaoNeural`）—— `voice.js:54`；另三个是 `'baidu'`(:59) / `'youdao'`(:64) / `'sapi'`(:116)。
**【实测】控制台上的文案：** `声音走 Edge 朗读，晓晓音色，落成 mp3 再放出来。` —— `packages/dsh-companion-dashboard/lib/client.js:1647`。
**【实测】README 说法：** `引擎链按「免费、不要 key」排序：Edge 朗读（晓晓，首选）→ 百度公开朗读 → 有道词音 → Windows SAPI。` —— `packages/dsh-anima/README.md:27`。

### 6.3 「本机合成」这个说法要修正

- **不是本机合成。** Edge 那条是**联网**走微软 Edge「大声朗读」服务：`HOST = 'speech.platform.bing.com'`（`edge-tts.js:11`）、`tls.connect({ host: HOST, port: 443 })`（`:240`）、SSML 走 WebSocket（`:275-277`）。
- **本机做的是：** 落盘到 `<DSH_HOME>/anima/voice/`（`voice.js:19-21`），文件名 `say-<stamp>-<engine>-<rand>.<mp3|wav>`（`voice.js:165`），再用 `ffplay` 播放（`voice.js:177-183`）。
- 源码注释的准确表述：`只在本机落盘到 $DSH_HOME/anima/voice/，不传任何账号信息。` —— `voice.js:7`。
> ⚠️ 画面若写「本机合成 / 离线合成」→ **不准确**（`sapi` 那档才是离线）。准确说法：**「合成一句 mp3，落在本机，再放出来」**。

### 6.4 小爱音箱播放路径（真名 `xiaomi_say`）

**【实测】工具名 `xiaomi_say`** —— `index.js:726`。
**【实测】播放链路（代码原文）：**
```js
const made = await synthesize(text, { engine: args.engine, voice: args.voice })   // 先合成，用的是她的嗓子
...
return { ok: true, spoken: true, via: 'url', device, url: published.url, ip: published.ip, port: published.port, engine: made.engine, bytes: made.bytes }
```
证据：`index.js:1084,1109`。
**【实测】机制注释：** `说话走「本地临时 HTTP 服务 + 音箱自己来拉」：音箱放出来的是她的音色（天猫/晓晓），而不是音箱自己的合成音。URL 必须落在局域网 IP 上——音箱是从自己的网卡访问这台机的。` —— `index.js:872-873`。
**【实测】两条 via：** `'url'`（挂局域网 URL 让音箱拉，主路径）与 `'tts'`（`音箱自己的音色兜底`）—— `index.js:1092,1109`；成功串 `'已通过' + where + '开口（' + how + '，' + engine + '，' + NKB + 'KB）'` —— `index.js:740`。
**【实测】小米凭证文件：** `<DSH_HOME>/anima/mi.json` —— `packages/dsh-anima/lib/xiaomi.js:12`（`TOKEN_PATH`）。
**【实测】设备型号白名单（只认 `player_play_music` 的固件）：** `LX04, LX05, L05B, L05C, L06, L06A, X08A, X10A, X08C, X08E, X8F, X4B, OH2, OH2P, X6A` —— `xiaomi.js:22`。
**【实测】HTTP 路由：** `POST /anima/api/speak`（`index.js:1502`）、`GET /anima/api/xiaomi/devices`（`:1525`）、`POST /anima/api/xiaomi/ears`。
**【实测】控制中心按钮：** `说`（`client.js:1657`）、`对音箱说`（`:1668`）、`开耳朵` / `关耳朵`（`:1674`）、`没找到小爱音箱`（`:1667`）。

---

## 7. B站值班 / QQ / 表情包：真实名称与产出物

### 7.1 B站值班报告（产出物）

- **文件名/路径：** `<DSH_HOME>/bili-duty/out/YYYY-MM-DD.md` —— `packages/dsh-anima/lib/ephemeral.js:8`（正则 `DATE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/` 在 `:29`）。
- **数据目录解析顺序：** `<DSH_HOME>/bili-pond/config.json` 的 `home` → `<DSH_HOME>/bili-duty/config.json` 的 `home` → `<DSH_HOME>/bili-duty` —— `ephemeral.js:37-51`。
- **多轮追加的轮次标题格式：** `# … 第 N 轮（HH:MM）`；解析器会剥掉 `B站鱼塘 · ` 前缀 —— `ephemeral.js:177-178`。真实样例：`2026-11-01 第 2 轮（00:44）` —— `docs/VERIFICATION.md:1155`。
- **挑中条目的字段名（画面可用的正文标签，逐字）：** `**标题**` / `**UP**` / `**播放**` / `**链接**` / `**为什么值得**` / `**跳过**` / `**挑中**` —— 正则 `ephemeral.js:195`；条目首行是 `### BV<10位>` —— `:187`。
- **旧单行格式：** `- BVxxxx · 标题（0:53 / 3 播放）—— 点评` —— `ephemeral.js:14`。
- **分节标题：** `## 优先看 | 排队 | 下一轮` 判为「排队」，其余判为「跳过」—— `ephemeral.js:184`。
- **临时记忆产出文件：** `<DSH_HOME>/anima/ephemeral.json` —— `ephemeral.js:32-34`；保留 `KEEP_DAYS = 7` 天，提示只给最近 `PROMPT_DAYS = 2` 天，`PROMPT_MAX_LINES = 18`，点评截断 `PROMPT_VERDICT_MAX = 90` —— `ephemeral.js:22-25`。
- **控制中心「B站」分支的卡片标题：** `值班模型（B站自动跑那一轮用哪条线路）` —— `client.js:968`；说明串 `B站 扫码登录与浏览在设置 →「B站」面板；写操作默认关闭，每日额度由插件代码级上限控制。` —— `client.js:1109`。
- **值班不跑模型不花钱：** `日常刷视频不花模型额度，只有生成报告／评论那一轮才会用到这里选的线路。` —— `client.js:1026`。

### 7.2 QQ 通道

- **通道名（原样）：** `QQ` —— `packages/dsh-anima/lib/index.js:804`（`if (id.indexOf('onebot') === 0) return 'QQ'`）。
- **服务行名：** `QQ 桥接` / `QQ 客户端` —— `client.js:1574-1575`。
- **实际链路（文档原样）：** `NapCat（小号 3660096629）→ 反向 WS ws://127.0.0.1:8643/ws → dsh-onebot-qq → deepseek-web/deepseek-reasoner → 回传 QQ` —— `docs/VERIFICATION.md:285`。
- **accessToken 真值：** `dsh-companion-onebot` —— `packages/dsh-onesoul/cordis.patch.yml:54,68`。
- **出站管道未就绪的真实报错串：** `还没有捕获到出站管道：先让机器人收到任意一条 QQ 消息` —— `packages/dsh-companion-dashboard/lib/qq-split.js:76,85`。
- **长回复切分上限：** `MAX_CHUNK = 180`、`MAX_MESSAGES = 12` —— `qq-split.js:91-92`。

### 7.3 控制台对话 / 小爱提问（通道归属）

- **控制中心对话框 → 通道名 `控制中心`** —— `index.js:808`；回合名 `anima-console-` + base36 —— `index.js:1254`。
- **小爱提问 → 通道名 `小爱`** —— `index.js:806-807`。
- **B站 → `B站`**（`index.js:805`）、**桌面 → `桌面`**（`:809`）。
- **顺序常量：** `const CHANNEL_ORDER = ['控制中心', 'QQ', 'B站', '小爱', '桌面']` —— `index.js:813`。
- **`仅 Onesoul` 模式下剔除的是 `桌面`** —— `index.js:815-817`。
- **对话页（chat）标题：** `CONVERSATION` + `对话` —— `client.js:1790,1793`；范围标签 `仅 Onesoul 通道` / `全局` —— `:1791`。

### 7.4 表情包

- **通道/分支名：** `表情包` —— `client.js:1854`、`packages/dsh-companion-dashboard/lib/index.js:404`。
- **图库根目录：** `<DSH_HOME>/meme-packs` —— `packages/dsh-companion-dashboard/lib/index.js:386`、`media-roots.js:30`、`meme-inline.js:29`。
- **占位标记语法（逐字）：** `[表情: 描述]` —— 正则 `const MARKER = /\[表情\s*[:：]\s*([^\[\]]{1,80})\]/g` —— `meme-inline.js:19`。
- **控制台显示：** `图库：N 个（共 M 张）` —— `client.js:320`；`表情包图库在设置 →「表情包」面板；当前图库目录见下方路径。` —— `client.js:1110`。
- **依赖包：** `dsh-meme`（装配行 id 历史上是 `dsh-expression`）—— `cordis.patch.yml:38-39`。

---

## 8. 许可、仓库地址

**【实测】LICENSE 文件存在：** `packages/dsh-onesoul/LICENSE`，第 1 行原文 `MIT License`，第 3 行 `Copyright (c) 2026 dsh-onesoul contributors`（`packages/dsh-onesoul/LICENSE:1,3`）。
**【实测】无 SPDX 行：** LICENSE 文件里**没有** `SPDX-License-Identifier:` 行（全文 21 行，grep 无命中）。
**【实测】package.json 的 license 字段：** `"license": "MIT"` —— `packages/dsh-onesoul/package.json:58`（另三个包同样：`dsh-anima/package.json:31`、`dsh-companion-dashboard/package.json:41`、`dsh-companion-bundle/package.json:45`）。
**【实测】README 许可段原文：**
> `MIT。内置的灵魂与控制中心代码同样 MIT；七个上游插件版权归各自作者。` —— `packages/dsh-onesoul/README.md:102`。
> `MIT。上游七个插件（dsh-better-sidebar、dsh-deepseek-web-login、dsh-onebot-qq、dsh-napcat-keeper、dsh-bili-pond、dsh-meme、dsh-our-free-model）版权归各自作者。` —— `README.md:36-37`。

**【实测】仓库地址（两个都是真的，形式不同）：**

| 来源 | 值 |
|---|---|
| `git remote -v` | `origin  git@ssh.github.com:D-W-N/dsh-onesoul.git` |
| `package.json` repository.url | `git+https://github.com/D-W-N/dsh-onesoul.git` |
| `package.json` homepage | `https://github.com/D-W-N/dsh-onesoul#readme` |
| `package.json` bugs.url | `https://github.com/D-W-N/dsh-onesoul/issues` |

证据：`git remote -v`（只读命令输出）；`packages/dsh-onesoul/package.json:62-69`。
**【文档】发布记录里的网页地址：** `https://github.com/D-W-N/dsh-onesoul`（tag `v0.1.2`）—— `docs/PUBLISH.md:16`；`npm` 包页 `https://www.npmjs.com/package/dsh-onesoul` —— `docs/PUBLISH.md:15`。

> ✅ 画面写 `https://github.com/D-W-N/dsh-onesoul` 是**正确**的（和 package.json 的 homepage 一致）；remote 的 `git@ssh.github.com:` 只是 ssh 形式，不是对外展示地址。
> ⚠️ **没有 shields.io / badge**：全仓库（仅仓库自有文件）grep `shields|badge|CSPDX` **0 命中**。分镜若要画「MIT 徽标」，请自己画一个静态徽标，不要声称是从 README 截的图。

---

## 9. 既有品牌色 / 强调色

**【实测】`#dca765` 真实存在，就是控制中心的强调色（暗色主题）：**

```css
.cmp-console.dark{--c-bg:linear-gradient(170deg,#0b0e13 0%,#080a0e 60%,#0a0d12 100%);...;--c-accent:#dca765;--c-ok:#5fbf8a;--c-off:#5c666f;--c-hl:rgba(220,167,101,.16);...}
```
证据：`packages/dsh-companion-dashboard/lib/client.js:89`（`--c-accent:#dca765`）。**内置副本同位置：** `packages/dsh-onesoul/plugins/dashboard/lib/client.js:89`。

**【实测】亮色主题的强调色是另一个值：** `--c-accent:#b5762c` —— `client.js:90`。
**【实测】琥珀系高亮底：** `--c-hl:rgba(220,167,101,.16)`（暗）/ `rgba(181,118,44,.12)`（亮）—— `client.js:89,90`。

**完整调色板（暗色，可直接抄进分镜的 CSS/画面）：**

| 变量 | 值 | 用途 |
|---|---|---|
| `--c-bg` | `linear-gradient(170deg,#0b0e13 0%,#080a0e 60%,#0a0d12 100%)` | 页面底 |
| `--c-card-a` | `rgba(40,47,58,.44)` | 卡片渐变起 |
| `--c-card-b` | `rgba(13,16,22,.56)` | 卡片渐变止 |
| `--c-line` | `rgba(255,255,255,.09)` | 细线 |
| `--c-line-strong` | `rgba(255,255,255,.20)` | 强线 |
| `--c-text` | `#e7e9ec` | 正文 |
| `--c-dim` | `#939daa` | 次要文字 |
| `--c-kick` | `#7b8794` | kicker 小标题 |
| `--c-accent` | `#dca765` | **强调色（琥珀金）** |
| `--c-ok` | `#5fbf8a` | 在线/成功 |
| `--c-off` | `#5c666f` | 离线 |
| `--c-hl` | `rgba(220,167,101,.16)` | 当前项高亮底 |
| `--c-a1` | `rgba(224,168,98,.34)` | 光晕 1 |
| `--c-a2` | `rgba(74,124,198,.30)` | 光晕 2 |
| `--c-a3` | `rgba(130,94,182,.24)` | 光晕 3 |

证据：`client.js:89`（一行内含全部）。

**`--c-accent` 被用在这些元素上（逐处证据）：**
`她` 的发言人标签（`client.js:120,158`）· 键盘焦点描边（`:125`）· 选中的范围按钮描边（`:128`）· 记忆行当前项左边条与序号（`:136-137`）· 行内链接 `.cmp-a`（`:145`）· 服务行 hover 名（`:170`）· 服务行 `→` 箭头（`:171`）· 房间格 hover 描边（`:177`）· 当前房间格（`:180`）· 模型候选列表的 `＋`（`:1217`）。

**【实测】视觉基底还有一层「光晕」：** `.cmp-aura` 元素 —— `client.js:1593`（每个页面都挂）。
**【实测】字体：** 数字用 `font-variant-numeric:tabular-nums` 对齐（`client.js:68,133,156`）。

---

## 10. 分镜原文逐条对表（用户写 → 仓库真实）

| # | 分镜原文（用户硬性要求逐字） | 判定 | 仓库真实 / 说明 |
|---|---|---|---|
| 1 | `dsh plugin add dsh-onesoul` | ⚠️ **不一致** | 真实形态是 `dsh plugin add --profile web dsh-onesoul`（`README.md:7`）。仓库里**从未出现**不带 `--profile` 的写法。若必须保留这 11 个字符，建议画面用省略号或改成分两行（第一行 `dsh plugin add`，第二行缩进 `--profile web dsh-onesoul`）。 |
| 2a | `anima_memory_capture({ text: "主人只喝美式，不加糖", source: "qq" })` | ✅ **一致** | `text` / `source` 都是真参数名（`index.js:364,366`）；`source` 示例值就是 `qq`（`:366` 描述里写 `dsh-session / qq / bili / import`）。`text` 是 `required: true`。 |
| 2b | `// 先记进候选池` | ✅ **一致** | 工具描述原文：`把值得长期记住的事记成【候选记忆】。候选不会进入事实区，必须由用户裁决通过才生效。`（`index.js:362`）；返回串 `已进入候选池（待审 N 条）：mem_xxx`（`:398`）。 |
| 2c | `anima_memory_pending()` | ✅ **一致** | 无必填参数（只有可选 `limit`，`index.js:406`）；空参数调用合法。 |
| 2d | `// 候选池，进不了提示词` | ✅ **基本一致（有细微差别）** | 候选**正文**确实不进（`model.js:201,223`，冒烟 `smoke.mjs:127` 就在断言这条）。但候选的**标题与条数**会以 `## 待用户裁决的候选记忆（N 条）` 出现在提示词里（`model.js:240`）。画面写「进不了提示词」可接受；若要做到零折扣，写「正文进不了提示词」。 |
| 2e | `anima_memory_decide({ id: "mem_xxx", decision: "approve" })` | ✅ **一致** | 参数名就是 `id` + `decision`（`index.js:423-424`），`decision` 取值 `approve` / `reject`（`:424`）。`id` 支持字面量 `"latest"`（`:423`）。 |
| 2f | `// 只有你点了头，才算数` | ✅ **一致** | 描述原文：`裁决权属于用户，模型不得自行 approve。`（`index.js:421`）；成功串 `已通过并写入长期记忆：`（`:444`）。 |
| 3 | `anima_speak({ text: "早安，主人" })` | ✅ **一致** | 工具名与 `text`（required）都对（`index.js:697,700`）。另有可选 `force` / `play` / `engine`（`:701-703`）。 |
| 4 | `dsh-anima: 耳朵收到 1 条；reply=true；判定=答不上` | ✅ **完全一致** | 格式串逐字吻合（`index.js:1326`），`判定=答不上` 是合法取值（`:1324`）。唯一注意：多条时 `判定=` 会变成逗号拼接（`marks.join(',')`）。 |
| 5 | `"chain": [ { "provider": "buddy", "model": "hy4free" }, { "provider": "buddy", "model": "hy3" } ], "onFail": { "advance": true, "restart": true }` | ❌ **provider/model 不存在；结构完全正确** | 键名 `chain` / `provider` / `model` / `onFail` / `advance` / `restart` **全部真实**（`dashboard/lib/index.js:455-463`）。但 `buddy` / `hy4free` / `hy3` **全仓库 0 命中**。真实线路例：`deepseek-web / deepseek-reasoner`、`our-free-model / combo:free`。 |
| 6 | `dsh plugin add dsh-onesoul · 开源 MIT` | ⚠️ **前半同 #1；后半真实** | MIT 真实（`LICENSE:1`、`package.json:58`）。命令同 #1 缺 `--profile web`。 |
| 附 | `--c-accent:#dca765` | ✅ **真实** | `client.js:89`（暗色）；亮色是 `#b5762c`（`:90`）。 |

---

## 11. 未证实 / 冲突 / 需要用户拍板

### 11.1 与实现明确冲突（必须改）

1. **`hy4free` / `hy3` / `buddy` provider 不存在。** `packages/` 全量 grep `hy4free|hy3|buddy` = 0 命中。真实 provider 见 §5.1。
2. **`dsh plugin add dsh-onesoul` 缺 `--profile web`。** 仓库全部 4 处安装命令都带 `--profile`（`README.md:7`、`packages/dsh-onesoul/README.md:9`、`docs/PUBLISH.md:17`、`docs/STATUS.md:83`）。需要用户拍板：**改文案** 还是 **画面保留原样但接受「与真实安装命令不一致」**。
3. **「本机合成」不准确。** Edge TTS 是联网合成（`edge-tts.js:11,240`），本机只做落盘 + 播放（`voice.js:7,19-21,177-183`）。
4. **`packages/dsh-anima/README.md:39` 把 `/anima/api/decide` 的字段写成 `verdict`，实现是 `decision`**（`index.js:1566`、`client.js:368`）。README 过期；实现为准。

### 11.2 需要用户拍板的小口径

5. **Tab 名「控制中心」vs 首屏分支「总览」**：侧边栏 Tab 叫 `控制中心`（`client.js:1906`），但它内部第一屏的导航按钮叫 `总览`（`:1856`）。分镜若说「打开控制中心」→ 对；若说「控制中心总览页」→ 也对，但页面上出现的字是 `总览`。
6. **`厨房` vs `厨房·餐室`**：灵魂层房间名是 `厨房·餐室`（`presence.js:6`），控制中心平面图写 `厨房`（`client.js:1372`）。画面用哪个都能自证，建议统一用 `厨房`（离视觉素材更近）。
7. **`房间` 集合里没有 `卧室`**，最接近的是 `次卧`（`presence.js:5`，`guest`）。**没有 `浴室`、`客厅外`、`书房外` 之类。** 完整的 7 个就是：客厅 / 餐厅 / 阳台 / 次卧 / 厨房·餐室 / 玄关 / 书房。
8. **`mem_xxx` 只是占位。** 真实 id 形如 `mem_mvquxh77_36411625`（`docs/FEASIBILITY.md:24`）。若要特写 id，用真实样例更可信；若只是示意，`mem_xxx` 与工具描述一致（`index.js:453`）。
9. **`anima-ears-` 后缀不是随机串**，是 `Date.now().toString(36)`（`index.js:1217`）；且回合**复用**不新建（`:1208`）。README `:69` 写「`<随机>`」属于简化说法。

### 11.3 未证实（仓库里找不到证据，不要写进画面）

10. **没有任何 badge / shields.io 徽标。** grep `shields|badge|CSPDX` 在仓库自有文件中 0 命中。「MIT 徽标」需自行绘制，不能声称来自 README。
11. **LICENSE 里没有 SPDX 标识行**（`packages/dsh-onesoul/LICENSE` 全文 21 行，无 `SPDX-License-Identifier`）。画面若写 SPDX，只能写 `MIT`（来自 `package.json:58`），不要写 `SPDX-License-Identifier: MIT` 并声称抄自 LICENSE。
12. **`model-chain.json` 没有仓库内样例文件。** schema 是从 `readModelChain()` 的归一化代码反推的（`dashboard/lib/index.js:452-467`）；`chain` 里具体填哪几条线路完全取决于用户本机配置。文档里给的 `deepseek-web/deepseek-reasoner` 是**部署默认模型**（`cordis.patch.yml:73-74`），不是 model-chain.json 的内容。
13. **没有 `dsh plugin list` / 安装成功的终端输出样例。** `docs/` 里有 `dsh --profile web --dump-config` 的计数（`docs/VERIFICATION.md:107` 记为 1376 行、后又有 1275/1386 行等不同数字），**互相不一致**，建议画面不要出现具体行数。
14. **`npm 已发布` 状态的时效性。** `docs/PUBLISH.md:3` 称 2026-11-13 已发布 `0.2.6`（npm latest=0.2.6）；但 `docs/STATUS.md:75` 仍写着「未做：npm 发布（唯一剩余项）」且 `docs/STATUS.md` 内容明显更旧（包版本写成 anima@0.1.10 / dashboard@0.1.35，而 `packages/` 里是 0.1.33 / 0.1.57）。**若画面要打「已上 npm」，建议以 PUBLISH.md 为准，并由用户确认。**
15. **`耳朵` 的日志是否真的会被打到用户可见的终端**：代码用 `ctx.logger.info`（`index.js:1326`），注释里还写了 `耳朵的判定落一份文件：日志链路会不会吞掉这行我保证不了，文件一定在。`（`index.js:1116`）。所以**日志行可能被上游吞掉**；要保证画面 100% 有这行，用 `ears-trace.log` 的格式更稳，或接受「理想化日志」。
16. **`判定的多条拼接形态`** 未在文档里出现过真实样例（`docs/` 里没有 `判定=` 的实例），只有代码可证。

### 11.4 已确认、可放心大字号上画面的原文串

- `dsh plugin add --profile web dsh-onesoul`
- `anima_memory_capture` / `anima_memory_pending` / `anima_memory_decide` / `anima_speak` / `xiaomi_say`
- `dsh-anima: 耳朵收到 1 条；reply=true；判定=答不上`
- `## 已确认的长期记忆（索引）` / `## 待用户裁决的候选记忆（N 条）`
- `ON-LINE` / `OFF-LINE`；`HOME / LIVE` / `INDOOR` / `SYSTEM` / `MY HEAR` / `MEMORY` / `QQ / OWNER`
- `控制中心` / `总览` / `对话` / `记忆` / `QQ` / `B站` / `表情包` / `模型`
- `客厅` `餐厅` `阳台` `次卧` `厨房·餐室` `玄关` `书房`
- `很好` / `不错` / `平静` / `低落` / `很差`
- `zh-CN-XiaoxiaoNeural`；`--c-accent:#dca765`
- `"chain"` / `"provider"` / `"model"` / `"onFail"` / `"advance"` / `"restart"` / `"reasoningEffort"` / `"lastFailAt"` / `"lastFailNote"`
- `MIT`
