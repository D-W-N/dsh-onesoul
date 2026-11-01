# dsh-onesoul

**一个灵魂，多个通道。** 把人格与长期记忆、控制中心、QQ / B站 / 表情包通道装配成一条
`dsh plugin add` 装齐的 [DeepSeek Harness](https://github.com/deepseek-ai) 插件包。

```bash
dsh plugin add --profile web dsh-onesoul
```

* 发布包：`dsh-onesoul`（本仓库 `packages/dsh-onesoul`）
* 用户文档：[`packages/dsh-onesoul/README.md`](packages/dsh-onesoul/README.md)
* 设计与验证记录：[`docs/VERIFICATION.md`](docs/VERIFICATION.md)（按 §7.x 逐条留证据）
* 现状与待办：[`docs/STATUS.md`](docs/STATUS.md)　发布流程：[`docs/PUBLISH.md`](docs/PUBLISH.md)

## 仓库结构

| 路径 | 说明 |
|---|---|
| `packages/dsh-anima/` | 灵魂层源码：人格、长期记忆（候选/裁决/账本）、临时记忆、系统提示注入 |
| `packages/dsh-companion-dashboard/` | 控制中心源码：侧边栏 Tab、记忆裁决、主人号/朋友号、B站值班、表情包、模型 |
| `packages/dsh-onesoul/` | **对外发布的唯一包**：单一入口 + 装配 patch，内置前两者的 `lib/` |
| `packages/dsh-companion-bundle/` | 旧的三包聚合形态（保留用于对比与回滚，不再发布） |
| `scripts/` | `build-onesoul.mjs` 构建/打包、`smoke.mjs` 冒烟、`ssr-check.mjs` 渲染检查 |
| `docs/` | 可行性、状态、验证、发布记录 |

## 构建与验证

```bash
node scripts/build-onesoul.mjs --pack        # 同步内置副本 → 打 tarball 到 .verify/tarballs
node --import ./scripts/shims/resolver.mjs scripts/smoke.mjs
node scripts/ssr-check.mjs
```

## 许可

MIT。上游七个插件（`dsh-better-sidebar`、`dsh-deepseek-web-login`、`dsh-onebot-qq`、
`dsh-napcat-keeper`、`dsh-bili-pond`、`dsh-meme`、`dsh-our-free-model`）版权归各自作者。
