/**
 * dsh-onesoul —— 单一入口，内部挂两个插件：
 *
 *   plugins/anima     人格 + 长期记忆 + 临时记忆（dsh-anima）
 *   plugins/dashboard 控制中心 Tab（dsh-companion-dashboard）
 *
 * 为什么要合成一个入口：宿主只给「包根说明符」（exactPackageSpecifier）解析 dsh.client，
 * 子路径行（dsh-onesoul/dashboard）拿不到浏览器侧声明，控制中心 Tab 就永远不出现。
 * 所以对外只有一个包名 dsh-onesoul，两个子插件用 ctx.plugin 各自挂成独立 fiber
 * （各自的 inject 照旧生效，一个崩了不会连带另一个）。
 */
import * as animaPlugin from '../plugins/anima/lib/index.js'
import * as dashboardPlugin from '../plugins/dashboard/lib/index.js'

export const name = 'dsh-onesoul'
export const inject = []

/** 两个子插件都只认 allowLan；其余键各自忽略。可用 config.anima / config.dashboard 单独覆盖。 */
export function apply(ctx, pluginConfig) {
  const config = pluginConfig || {}
  const animaConfig = config.anima !== undefined && config.anima !== null ? config.anima : config
  const dashboardConfig = config.dashboard !== undefined && config.dashboard !== null ? config.dashboard : config
  ctx.plugin(animaPlugin, animaConfig)
  ctx.plugin(dashboardPlugin, dashboardConfig)
}
