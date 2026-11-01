# dsh-onesoul

> 一个灵魂，多个通道。给 [DeepSeek Harness](https://github.com/deepseek-ai) 装上**同一份人格与记忆**，
> 让它在桌面、网页、QQ、B站 上都是「它自己」，并把这些通道的状态收进侧边栏的一个控制中心里。

一条命令装齐：

```bash
dsh plugin add --profile web dsh-onesoul
```

（桌面版把 `--profile web` 换成 `--profile desktop`。）

---

## 1. 它做了什么

| 层 | 由谁提供 | 职责 |
|---|---|---|
| 灵魂 | **本包内置**（原 `dsh-anima`） | 人格（名字/称呼/风格/边界）+ 长期记忆（候选 → 你裁决 → 才注入）+ 临时记忆（值班见闻，自动写入，7 天滚动） |
| 界面 | **本包内置**（原 `dsh-companion-dashboard`） | 侧边栏「控制中心」Tab：记忆裁决、主人号/朋友号与主动互动、B站值班、表情包、默认模型，全程不跳页 |
| 宿主界面 | `dsh-better-sidebar` | 侧边栏与 Tab 注册 |
| 大脑 | `dsh-deepseek-web-login` | 把 chat.deepseek.com 的网页模型接成原生 provider（路由 `deepseek-web`） |
| QQ 通道 | `dsh-onebot-qq` + `dsh-napcat-keeper` | 真人 QQ 号的 OneBot11 反向 WS；看门狗负责拉起 NapCat、扫码超时重来 |
| B站通道 | `dsh-bili-pond` | 只读浏览/字幕/评论（点赞收藏默认关闭，必须带理由） |
| 表情 | `dsh-meme` | 表情包图库 |
| 模型补充 | `dsh-our-free-model` | 备用模型路由 |

自建的部分只有两个：**灵魂**与**控制中心**。其余七个包都是独立发布的上游插件，本包只负责装配，
不复制它们的源码 —— 上游修好了，你 `npm update` 就跟着好。

## 2. 装完你会看到

* 侧边栏多出一个「控制中心」Tab，五个分支：
  `记忆` / `QQ` / `B站` / `表情包` / `模型`。
* 人格与记忆存在 `<DSH_HOME>/anima/`（默认 `~/.dsh/anima/`）：
  * `persona.json` —— 人设（可热改，立即对所有会话生效）
  * `memory.json` —— 长期记忆，**只有 `approved` 的条目会进系统提示**
  * `ephemeral.json` —— 临时记忆（B站值班见闻），自动写入、不进审核队列
  * `ledger.jsonl` —— 账本，哈希链；改一个字段、删一行、插一行都会在审计里报红
* 全部数据都在本机，没有任何联网存储。`anima_memory_audit` 可以随时验账本完整性。

## 3. 记忆是怎么生效的

1. 对话里说「记住…」→ 落成**候选**（`candidate`），不生效；
2. 你在控制中心「记忆」分支里裁决：`approve` 写入长期记忆并注入，`reject` 丢弃并留痕；
3. 系统提示里只给**索引行**（`- [mem_xxx] 前 42 字…（标签）`），模型判断需要细节时再调
   `anima_memory_get` 取全文 —— 不会把整本记忆推进上下文。

## 4. 配置

默认值即可用。想改就编辑 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml`，
用**同 id 的顶层行**覆盖（不要改本包的 `cordis.patch.yml`，升级会被覆盖）：

```yaml
# 只让「你自己的 QQ」能用管理员命令（/new、/workspace、/model --default 等）
- id: dsh-onebot
  config:
    adminUsers:
      - '1234567890'
    # QQ 会话的工作区（不写会落到宿主启动目录）
    workspacePath: D:/work/qq-playground

# 挂到 dsh-onesoul 行上、只作用于灵魂层的键
- id: dsh-onesoul
  config:
    anima:
      # 让值班 profile 也算「同一个灵魂」通道（整个进程都注入人设与记忆）
      channelProfile: true
```

两个注意点：

* `dsh-onebot` 与 `napcat-keeper` 的 `accessToken` 必须一致（默认都是 `dsh-companion-onebot`）。
* 默认模型是 `deepseek-web / deepseek-reasoner`；换模型改 `agent-default-model` 那行。

## 5. 已知限制（诚实写在这）

1. **QQ 主动消息需要一个前置条件**：主动发消息借的是那条 QQ 出站管道，
   所以机器人必须先收到过至少一条 QQ 消息；之前面板会显示「还没捕获出站管道」。
2. **NapCat 首次登录要人工一次**：扫码或密码回退；连续密码登录会触发风控要求短信验证。
   `start-napcat.bat` 支持 `-q <账号>` 快速登录，配合 `ACCOUNT` + `NAPCAT_QUICK_PASSWORD` 环境变量可无人值守。
3. **记忆隔离是「通道级」的**：`memoryApplies: false` 的普通桌面会话完全不注入人设与记忆（一个字都不进上下文）。
4. 长回复按句切分后一条消息一句；一轮上限 12 条，超出的只合并最短的相邻两段。

## 6. 开发

本仓库仍是三个开发包（`packages/dsh-anima`、`packages/dsh-companion-dashboard`、
`packages/dsh-onesoul`），发布前用构建脚本把前两个的 `lib/` 复制进 `packages/dsh-onesoul/plugins/`：

```bash
node scripts/build-onesoul.mjs --pack   # 同步内置副本并打 tarball
node --import ./scripts/shims/resolver.mjs scripts/smoke.mjs   # 37 项冒烟
```

为什么合成一个入口而不是发三个包：宿主只给**包根说明符**解析 `dsh.client`
（`exactPackageSpecifier` 对子路径返回 undefined），子路径行拿不到浏览器侧声明，
控制中心 Tab 就永远不出现。所以 `lib/index.js` 里用 `ctx.plugin()` 把两个插件各挂成独立 fiber。

## 7. 许可

MIT。内置的灵魂与控制中心代码同样 MIT；七个上游插件版权归各自作者。
