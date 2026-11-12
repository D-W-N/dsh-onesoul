# dsh-anima

DSH 灵魂层插件：**单一人格 + 长期记忆候选/裁决**，并把人设与已确认记忆注入系统提示词。

## 行为

- 人格：全局人设 + 按工作区字段覆盖（空字段继承全局）。
- 记忆：`anima_memory_capture` 只写入 **pending 候选**；只有 `anima_memory_decide`（approved/rejected）之后，
  内容才会进入 `## 已确认的长期记忆` 并被注入。**刻意不做自动写入**。
- 提示词注入：通过 `ctx.systemPrompt.section({ name: 'dsh-anima:persona', order: 5, text }) ` 注册；
  候选记忆只出现标题与条数，正文不进提示词。

## 工具

`anima_status` · `anima_persona_get` · `anima_persona_set` · `anima_memory_capture` · `anima_memory_pending` ·
`anima_memory_decide` · `anima_memory_search` · `anima_memory_import` · `anima_state_get` ·
`anima_presence_move` · `anima_mood_note` · `anima_quiet` · `anima_speak`

## 一个大脑（运行时统一）

`session/event` 上只认 `user/message` 且 `source.kind === 'user'`：任何通道（QQ / 桌面 / 以后接的语音）
有人跟她说话，都会推进同一份 `runtime.json`——说话门醒过来、`lastUserAt` 刷新、心情记账。
她自己的输出、goal 轮、team 消息都不喂，否则会自激。

## 嗓子（anima_speak）

文字合成语音并在本机放出来，引擎链按「免费、不要 key」排序：Edge 朗读（晓晓，首选）→ 百度公开朗读 → 有道词音 → Windows SAPI。
SAPI 在部分机器上会被安全设置拒绝（看得到音色、`SelectVoice` 就报没有可用语音），所以它只是最后兜底。
说话门关着时不出声，那句话会被记进 `quiet.suppressed`；要强行开口用 `force: true`。

## HTTP（Host 半，默认只监听 loopback；配置 `allowLan: true` 可放开）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/anima/api/status` | 人设 + 记忆计数 |
| GET | `/anima/api/pending` | 待审候选 |
| GET | `/anima/api/approved` | 已确认记忆 |
| GET | `/anima/api/persona` | 读人设 |
| POST | `/anima/api/decide` | `{ id, verdict: 'approve' \\| 'reject', note? }` |
| POST | `/anima/api/capture` | `{ text, source? }` 写入候选 |
| POST | `/anima/api/persona` | 改人设（顶层字段 + `workspace`） |

## 存储

`$DSH_HOME/anima/persona.json`、`$DSH_HOME/anima/memory.json`（原子写 tmp+rename，读写串行化）。

## 装配

```yaml
- insert:
    - id: dsh-anima
      name: dsh-anima
```

## cordis 注意

`export const inject = ['tools', 'systemPrompt', 'agents', 'agentDefaultModel']` 必须是**服务名数组**
（webServer 不进静态 inject：headless profile 没有它，硬依赖会让插件永不激活——用 `ctx.inject` 等它出现再挂路由，耳朵的自动开启也挂在这条路径上，保证只有桌面进程开）；
apply 内只能读已注入的服务属性（`ctx.config` 不在其中，配置取 apply 第二参）。

## 耳朵（小爱音箱）

有 `mi.json` 就**自动开**，不用去控制台点：每 3 秒拉一次
`https://userprofile.mina.mi.com/device_profile/v2/conversation`（要 `userId` / `deviceId` / `serviceToken`
三个 cookie；miservice 里的 `nlp_result_get` 在 LX04 上返回空，别用那条）。

- 新问题 → `recent-chat.json`（`channel: 小爱`）+ 当成一次「用户说话」喂 runtime（说话门/心情）
- 小爱答不上来（或用户点名「问问阿音」）且是 90 秒内的新话 → 开一个她自己的回合
  （`anima-ears-<随机>`，复用同一个），让她一句话回答并 `xiaomi_say` 送到音箱
- 判定与失败都落 `$DSH_HOME/anima/ears-trace.log`（自限 256KB，空轮询不写）
