# QQ 通道插件调研（真人号 / OneBot 11 · NapCat）

> 目的：用户要的是「AI 控制**真人 QQ 号**」，不是官方机器人（AppID/AppSecret）。
> 结论先行：**插件层不区分主号/小号** —— NapCat 登录哪个 QQ 号，AI 就是哪个号。
> 「像人」的差异落在两个地方：①插件有没有拟人延迟/禁回/限速；②你拿哪个号去登 NapCat。

调研方式：把 10 个候选装进隔离目录 `.verify/qq-survey/`（`npm install --no-save`），
读它们的 `package.json` / `cordis.patch.yml` / 入口源码与 README 统计（`survey.mjs` 可复跑）。
实测日期：2026-10-28。本机 dsh `0.2.0-rc.2`。

## 一、候选一览（按工具数量排序）

| 包 | 版本 | 工具数 | 拟人/风控 | 自带 patch | 定位 |
|---|---|---|---|---|---|
| `dsh-qq-tools` | 0.9.0 | **23** | 无（工具体） | ✅ | 群/好友/私聊/表情/头像/QQ空间全套工具，11 个组件可单独开关；需配合已有 OneBot 通道 |
| `dsh-qq-onebot` | 1.2.2 | 18 | 主号/小号概念 | ✅ | 表情、戳一戳、拍一拍、名片赞、群文件、撤回；peer 要求 `dsh-agent >=0.1.0-rc.6` |
| `dsh-qq-gateway` | 1.0.7 | 9 | **拟人延迟（按字数+长尾抖动）+ 禁回（按时长/指定人）+ 主号 `/allow` `/mute` 指令** | ✅ | 收 → 投给一个 DSH 会话 → 回复自动回传；掉线重连、断线缓冲、只读状态端点 |
| `dsh-qq-moony` | 0.13.0 | 8 | **限速防封**、随机 2–7 秒延迟 | ✅ | 小号 + 表情库（按情绪挑图）+ 空间说说 + 自己找话题 |
| `dsh-onebot-qq` | 0.9.6 | 7 | 无（工程向） | ✅ | 反/正向 WS、语音转写 STT、Markdown 转图、合并转发展开、图片/语音/视频/文件；**每会话一个独立 agent** |
| `dsh-onebot-channel` | 0.4.0 | 5 | 无 | ✅ | 轻量通道：WS 事件入站 → `agent.followup` 唤醒会话 → `qq_send` 回话 |
| `dsh-onebot-hub` | 0.11.1 | 0 | — | ✅ | 双向枢纽：连上游 OneBot 实现，按 `downstreamTargets` 挂 N 条下游（ws-dial/listen、http-api/post） |
| `dsh-napcat-keeper` | 2.8.2 | 0 | — | ✅ | **看门狗**：端口不通就拉起 NapCat、卡扫码超时重来、互踢进程判重、心跳 |
| `dsh-qiyu-stack` | 0.16.6 | — | 作息/群轮次护栏 | ❌（无 dsh 字段） | 全栈一体化（QQ 桥+长期记忆+心情+语音+作息+NapCat 部署），预览版，需额外 `npx dsh-qiyu-stack stt` 等初始化 |
| `dsh-bot-gateway` | 0.3.10-beta | — | — | ❌ | 多平台远程任务网关（QQ NapCat/官方机器人/Telegram/飞书/钉钉），beta |

## 二、四个「真人号」事实

1. **协议端必须先有**：`NapCat`（或 Lagrange / LLOneBot / go-cqhttp）登录真实 QQ 号，插件只说 OneBot 11。
   `dsh-napcat-keeper` 能替你把 NapCat 拉起来，但**扫码/密码登录那一步必须你本人做**。
2. **账号 = NapCat 登录的号**：想「AI 用你的主号说话」就把主号登进 NapCat —— 代价是你手机/PC 的 QQ 会被挤下线，
   协议端任何异常都记在你本人账号头上。用新小号则这些代价转移到一个可丢弃的号。
3. **大多数插件默认「小号发言 + 主号发指令」**：`dsh-qq-gateway` 的 `mainQQ`/`botQQ` 两个配置项就是这个模型；
   `dsh-qq-moony` 明写「QQ 小号」。它们并不禁止你用主号登录，只是没有为「冒充本人」做任何保护。
4. **人格统一不受影响**：这些插件都是把 QQ 消息投进 DSH 会话，人格仍由 `dsh-anima` 的 `systemPrompt.section` 注入 ——
   QQ 上和她对话的仍是同一个「阿音」。

## 三、推荐组合

| 组合 | 组成 | 适合 |
|---|---|---|
| **A（推荐）** | `dsh-qq-gateway` + `dsh-napcat-keeper` | 只想「像人一样聊天」：拟人延迟、禁回、主号指令、掉线自愈，装配最小 |
| B | `dsh-onebot-qq` + `dsh-napcat-keeper` | 需要语音转写、Markdown 转图卡片、合并转发、每个会话独立 agent |
| C | `dsh-qq-gateway` + `dsh-qq-tools` + `dsh-napcat-keeper` | 既要像人说话，又要 23 个工具操作群/好友/空间；注意两条通道都收事件可能重复唤醒，需按组件关掉重复的 |
| D | `dsh-qiyu-stack` | 想要「住进 QQ 的完整人格」（记忆/心情/作息/语音）；代价是预览版且初始化步骤多 |

## 四、装配要点（组合 A 为例）

- 两个包都自带 `dsh.bundle.patch`，加进 `dsh.profile.bundles` 即自动插行，不必手写行。
- `dsh-qq-gateway` 的 `cordis.patch.yml` 原文要求：参数在 profile 的 `cordis.patch.yml` 里**按 id 覆盖**而非重复 `insert`，
  形如 `- id: qq-gateway` + `config: { host, token, mainQQ, botQQ, sessionId }`。
- 反向 WS 监听端口默认 `8792/onebot`（gateway）或 `8643`（dsh-onebot-qq）；NapCat 侧配 ws-reverse 指向它。
- 默认策略：私聊只回主号（或授权名单），群聊只回 @ 小号的消息 —— 想放开要显式改配置。

## 五、与现有官方机器人的关系

现在装在两个 profile 的 `@zaofan/dsh-qqbot` 是**官方机器人**（AppID/AppSecret、bot 身份、不能拿真人号）。
换成真人号通道后建议移除（用户已选「三处移除」），否则两套 QQ 通道会抢同一批会话、人格身份也会混。

## 六、最终选择（已落地，2026-10-28）

用户第二轮选择：**组合 B（`dsh-onebot-qq` + `dsh-napcat-keeper`）**，账号策略 **A（新小号发言，主号只发指令）**。
`@zaofan/dsh-qqbot` 已从聚合包与两个真实 profile 中移除（三处移除已完成）。

聚合包里的实际行（`packages/dsh-companion-bundle/cordis.patch.yml`）：

    - id: dsh-onebot
      name: 'dsh-onebot-qq'
    - id: onebot-settings-remote
      name: 'dsh-onebot-qq/settings-remote'
    - id: napcat-keeper
      name: 'dsh-napcat-keeper'
      config:
        enabled: true

外加文件末尾两条**顶层同 id 覆写行**，给两边配同一个非空 `accessToken`：

    - id: dsh-onebot
      config:
        accessToken: dsh-companion-onebot
    - id: napcat-keeper
      config:
        enabled: true
        accessToken: dsh-companion-onebot

原因（真机报错逼出来的，不是设计偏好）：`dsh-onebot-qq/lib/connection.js:250` 在 `accessToken === ''` 时直接抛
`reverse mode requires a non-empty accessToken`，整行插件不激活；两边 token 不一致时 NapCat 连上来会被 4401 拒绝。
`dsh-onebot-qq` 自带 patch 注释也写明「config 覆盖须挂 patch 文档顶层的同 id 行，insert 块内行 configEditor 不可寻址」。

实操三件事（只有本人能做）：① 装 NapCat 并用小号扫码登录；② 主号在面板里当管理号（`/allow`、`/mute`）；③ 想换 token 就两边同时改。
