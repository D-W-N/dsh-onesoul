/**
 * SSR 可行性检查：把真实打包产物 lib/client.js 在 Node 里跑一遍，
 * 验证 ① __ModuleLoader__ 协议可被 consume ② apply(ctx) 真的 registerTab
 * ③ 控制中心组件能被 React 服务端渲染且不抛错。
 * 运行：node scripts/ssr-check.mjs
 */
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'

const root = process.cwd()
const req = createRequire(path.join(root, '.probe', 'render', 'noop.cjs'))
const React = req('react')
const { renderToString } = req('react-dom/server')

let descriptor = null
const styleNodes = []
globalThis.window = {
  __ModuleLoader__: {
    load(desc) { descriptor = desc; return desc },
  },
}
globalThis.document = {
  createElement(tag) { return { tag, textContent: '', setAttribute() {} } },
  head: { appendChild(node) { styleNodes.push(node) } },
}

const file = path.join(root, 'packages', 'dsh-companion-dashboard', 'lib', 'client.js')
await import(pathToFileURL(file).href)

if (!descriptor || descriptor.id !== 'dsh-companion-dashboard') throw new Error('ModuleLoader 未被调用或 id 不符')
const mod = descriptor.factory((id) => {
  if (id === 'react') return React
  throw new Error('意外的 require: ' + id)
})
if (typeof mod.apply !== 'function') throw new Error('缺少 exports.apply')
if (!Array.isArray(mod.inject) || !mod.inject.includes('betterSidebar')) throw new Error('exports.inject 不含 betterSidebar')

let registered = null
mod.apply({
  get: (name) => (name === 'betterSidebar' ? { registerTab: (d) => { registered = d; return () => {} } } : undefined),
  effect: (fn) => fn(),
})
if (!registered) throw new Error('apply 未调用 registerTab')
if (registered.id !== 'companion:control-center') throw new Error('registerTab id 不符: ' + registered.id)

const html = renderToString(React.createElement(registered.component))
const must = ['cmp-panel', '记忆', 'QQ', 'B站', '表情包', '模型']
const missing = must.filter((token) => !html.includes(token))

const { ChannelBranch, ModelBranch, summarizeLive } = mod.__test
const qqHtml = renderToString(React.createElement(ChannelBranch, {
  branch: { id: 'qq', title: 'QQ', native: false, ready: true, hint: 'QQ 设置面板' },
  services: { installed: { '@zaofan/dsh-qqbot': '1.11.7' } },
  status: { services: { installed: { '@zaofan/dsh-qqbot': '1.11.7' } } },
}))
const biliHtml = renderToString(React.createElement(ChannelBranch, {
  branch: { id: 'bili', title: 'B站', native: false, ready: false, hint: 'B站互动设置面板' },
  services: { installed: {} },
}))

// 实测 payload 原样喂给 summarizeLive，验证三个通道分支的实时状态摘要
const liveQq = summarizeLive('qq', { value: {}, source: 'patch', writerProfile: '', writerAt: 0, nsConflict: null })
const liveBili = summarizeLive('bili', {
  ok: true,
  home: 'E:\\dsh-onesoul\\.verify\\home\\bili-duty',
  config: { perDay: 5, peakValley: false, autoRun: false },
})
const liveMeme = summarizeLive('meme', { ok: true, total: 24, packs: [{ id: 'dafeiyu-001', name: '大肥鱼', count: 24 }] })
const liveOk = liveQq[0].includes('尚无配置项')
  && liveQq[1].includes('patch')
  && liveBili.some((line) => line.includes('每日互动额度：5 次'))
  && liveBili.some((line) => line.includes('关闭（当前只读）'))
  && liveBili.some((line) => line.includes('bili-duty'))
  && liveMeme[0].includes('图库：1 个（共 24 张）')

const modelHtml = renderToString(React.createElement(ModelBranch, null))
const modelOk = modelHtml.includes('当前默认模型') && modelHtml.includes('保存为默认模型')

const { FreeChainCard, comboProvider } = mod.__test
const chainGroups = [{ id: 'our-free-model', name: '免费模型', models: [
  { id: 'combo:free', name: '免费链路 free' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat' },
] }]
const chainHtml = renderToString(React.createElement(FreeChainCard, { groups: chainGroups }))
const chainOk = chainHtml.includes('免费链路') && chainHtml.includes('保存链路') && chainHtml.includes('fallback')
const providerOk = comboProvider(chainGroups, 'free') === 'our-free-model' && comboProvider(chainGroups, 'nope') === ''

const { OwnerCard } = mod.__test
const ownerInst = new OwnerCard({})
ownerInst.state = {
  data: {
    owners: ['2634024517'],
    friends: ['3953927738'],
    proactive: { enabled: true, useModel: false, intervalMinutes: 30, windowStart: 9, windowEnd: 23, pool: [], lastSentAt: 1762000000000, lastError: '', dutyPush: { enabled: true, maxItems: 2, cooldownMinutes: 30, lastKey: '', lastAt: 1762000000000, lastText: '' } },
    nextDueAt: 1762001800000,
    outbound: { ok: true },
    duty: {
      dir: 'E:\\dsh-onesoul\\.verify\\home\\bili-duty',
      say: '额度用完了就该收手',
      items: [{ text: '用飞书在手机上批准任务', why: '远程审批一条链路', bv: 'BV1pFx16cE5B' }],
      key: '3|1|用飞书',
      pending: { due: false, why: 'already-pushed' },
      preview: '值班刚跑完，就一句：额度用完了就该收手 · 这一轮值得你看的 1 条 · ① 用飞书在手机上批准任务（远程审批一条链路） https://www.bilibili.com/video/BV1pFx16cE5B',
      lastKey: '3|1|用飞书',
      lastAt: 1762000000000,
      lastText: '上次那段',
    },
  },
  ownerInput: '', friendInput: '', poolText: '', interval: '30', winStart: '9', winEnd: '23', days: [1, 3, 5], dutyMax: '2', dutyCool: '30', busy: '', said: '', error: '',
}
function OwnerProbe() { return ownerInst.renderBody() }
const ownerHtml = renderToString(React.createElement(OwnerProbe))
const ownerOk = ownerHtml.includes('主人号')
  && ownerHtml.includes('2634024517')
  && ownerHtml.includes('3953927738')
  && ownerHtml.includes('已就绪')
  && ownerHtml.includes('现在发一条')
  && ownerHtml.includes('保存互动设置')
  && ownerHtml.includes('哪几天')
  && ownerHtml.includes('全周')
const dutyOk = ownerHtml.includes('值班摘要（发主人号）')
  && ownerHtml.includes('现在提一次')
  && ownerHtml.includes('保存值班推送设置')
  && ownerHtml.includes('下次会这样提：值班刚跑完')
  && ownerHtml.includes('这一轮已经提过')
  && ownerHtml.includes('上次内容：上次那段')
const { MemoryBranch } = mod.__test
function MemoryProbe() { return React.createElement(MemoryBranch, {}) }
const memoryHtml = renderToString(React.createElement(MemoryProbe))
const memoryOk = memoryHtml.includes('记忆生效范围')
  && memoryHtml.includes('全局（已选）')
  && memoryHtml.includes('仅 Onesoul 通道')
  && memoryHtml.includes('长期记忆与临时记忆对所有会话都注入')

const { BiliDutyCardV2 } = mod.__test
const biliInst = new BiliDutyCardV2({})
biliInst.state = {
  data: { ok: true, profile: 'headless', profileKnown: true, current: { provider: 'deepseek-account', model: 'deepseek-flash' }, providers: [], reuseRoutes: true, reusedRoutes: [], warnings: [] },
  duty: { exists: true, hasHeadlessApp: true, profile: 'headless', defaults: {}, bundles: [], dependencies: [] },
  cli: { needsRepair: false, dshBin: 'D:\\x\\bin.js', usingWrapper: false, saved: {} },
  pond: { dir: 'E:\\dsh-onesoul\\.verify\\home\\bili-duty', exists: true, autoRun: false, gate: true, days: [1, 3, 5], parked: true, parkedAt: 1762000000000, lastError: '' },
  provider: '', model: '', manual: '', manualProvider: '', catalog: null, busy: '', toast: '',
}
function BiliProbe() { return biliInst.renderBody() }
const biliCardHtml = renderToString(React.createElement(BiliProbe))
const pondOk = biliCardHtml.includes('鱼塘自动运行')
  && biliCardHtml.includes('哪几天')
  && biliCardHtml.includes('全周')
  && biliCardHtml.includes('让控制台按星期开关鱼塘的自动运行')
  && biliCardHtml.includes('（非排班日，已由控制台暂停）')
console.log(JSON.stringify({
  ok: memoryOk && missing.length === 0 && qqHtml.includes('QQ') && biliHtml.includes('B站') && liveOk && modelOk && chainOk && providerOk && ownerOk && dutyOk && pondOk,
  pondOk,
  memoryOk,
  providerOk,
  ownerOk,
  dutyOk,
  liveOk,
  modelOk,
  modelBranchRendered: modelHtml.length > 0 && modelHtml.includes('cmp-input'),
  liveQq,
  liveBili,
  tabId: registered.id,
  tabTitle: registered.title,
  order: registered.order,
  styleInjected: styleNodes.length,
  controlCenterHtmlLen: html.length,
  missingTokens: missing,
  qqBranchRendered: qqHtml.length > 0 && qqHtml.includes('cmp-card'),
  biliBranchRendered: biliHtml.length > 0 && biliHtml.includes('B站'),
}, null, 2))
