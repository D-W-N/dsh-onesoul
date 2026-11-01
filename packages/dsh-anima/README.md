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
`anima_memory_decide` · `anima_memory_search` · `anima_memory_import`

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

`export const inject = ['tools', 'webServer', 'systemPrompt']` 必须是**服务名数组**；
apply 内只能读已注入的服务属性（`ctx.config` 不在其中，配置取 apply 第二参）。
