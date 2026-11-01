/**
 * dsh-companion-dashboard —— Host 半。
 *
 * 只做一件事：把各子插件的状态汇总成一份 JSON 给浏览器半用。
 * 数据来源刻意做成「文件级 / 依赖清单级」的松散契约：读不到就退化，不抛错，
 * 这样子插件随便升级或卸载，仪表盘照样能开（故障隔离）。
 *
 * 记忆裁决不在这里实现：浏览器半直接调 dsh-anima 自己的 /anima/api/*。
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { installQqSplit, sendText, sendOneMessage, outboundStatus, currentBridge } from './qq-split.js'
import { installMediaRoots, extraMediaRoots, mediaRootsStatus } from './media-roots.js'
import { memeInlineStatus } from './meme-inline.js'
import { installChatModel, chatModelStatus, retargetLiveChats } from './chat-model.js'
import { applyPondGate, pondGateStatus, pondDir as pondGateDir, ALL_DAYS as POND_ALL_DAYS } from './pond-gate.js'

export const name = 'dsh-companion-dashboard'
export const inject = ['webServer']

const ROUTE = '/companion/api'

const KNOWN = {
  anima: ['dsh-anima'],
  bili: ['dsh-bili-pond', 'dsh-bili-scroll', 'dsh-shlr-bilitoolkit'],
  qq: ['dsh-onebot-qq', 'dsh-onebot-channel', '@zaofan/dsh-qqbot'],
  webds: ['dsh-deepseek-web-login', 'dsh-webds-bridge'],
  meme: ['dsh-meme'],
  sidebar: ['dsh-better-sidebar'],
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function safeJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

/** keeper 自己的配置文件（装没装、装在哪），读不到就当空 */
function keeperConfig() {
  return safeJson(join(dshHome(), 'dsh-napcat-keeper', 'config.json'), null) || {}
}

/** 免费模型插件（dsh-our-free-model）的设置：combos 是它的命名降级链。读不到就空。 */
function freeModelSettings() {
  return safeJson(join(dshHome(), 'our-free-model', 'settings.json'), null) || {}
}

/** 已配置的降级链（combo）：数组，每项 { name, models[], strategy } */
function comboCards() {
  const settings = freeModelSettings()
  const rows = Array.isArray(settings.combos) ? settings.combos : []
  return rows.map(function (row) {
    return {
      name: String((row && row.name) || ''),
      models: Array.isArray(row && row.models) ? row.models.map(String) : [],
      strategy: String((row && row.strategy) || 'fallback'),
    }
  }).filter(function (row) { return row.name !== '' })
}

// 活跃会话的热切换：本插件只保存每个会话的选择引用，重复调用只改 .current，不重复挂监听。
const liveSelections = new Map()

async function installModelSelection() {
  try {
    const mod = await import('@deepseek-ai/dsh-agent')
    return mod && typeof mod.installModelSelection === 'function' ? mod.installModelSelection : null
  } catch {
    return null
  }
}

/**
 * 把新的模型选择推给当前所有活着的会话（next step 生效，见 dsh-agent 的 model-selection.d.ts）。
 * 拿不到 agents 服务或 dsh-agent 模块时只退化返回，不影响默认值落盘。
 */
async function hotSwitchLiveAgents(ctx, next) {
  const install = await installModelSelection()
  if (install === null) return { supported: false, switched: 0, reason: 'dsh-agent-unavailable' }
  const agents = typeof ctx.get === 'function' ? ctx.get('agents') : null
  if (!agents || typeof agents.list !== 'function') return { supported: false, switched: 0, reason: 'agents-unavailable' }
  let list = []
  try { list = agents.list() || [] } catch { return { supported: true, switched: 0, reason: 'list-failed' } }
  let switched = 0
  for (const agent of list) {
    try {
      const sessionId = agent && agent.session && agent.session.id
      if (!sessionId || !agent.ctx) continue
      const hit = liveSelections.get(sessionId)
      if (hit) {
        hit.ref.current = next
      } else {
        const ref = { current: next, assembled: undefined }
        const dispose = install(agent.ctx, ref)
        liveSelections.set(sessionId, { ref: ref, dispose: dispose })
      }
      switched += 1
    } catch {}
  }
  return { supported: true, switched: switched, total: list.length }
}

function disposeLiveSelections() {
  for (const entry of liveSelections.values()) {
    try { if (typeof entry.dispose === 'function') entry.dispose() } catch {}
  }
  liveSelections.clear()
}

/**
 * NapCat 当前登录二维码的位置。
 * keeper 会把新鲜的码复制到 qrCopyPath（默认 <DSH_HOME>/dsh-napcat-keeper/qr.png），
 * 没有副本时退回 NapCat 自己写的那份 cache/qrcode.png。都不存在就返回空串。
 */
function napcatQrFile() {
  const config = keeperConfig()
  const keeperDir = join(dshHome(), 'dsh-napcat-keeper')
  const candidates = []
  if (typeof config.qrCopyPath === 'string' && config.qrCopyPath.trim()) candidates.push(config.qrCopyPath)
  candidates.push(join(keeperDir, 'qr.png'))
  if (typeof config.shellDir === 'string' && config.shellDir.trim()) {
    candidates.push(join(config.shellDir, 'napcat', 'cache', 'qrcode.png'))
  }
  for (const file of candidates) {
    if (existsSync(file)) return file
  }
  return ''
}

/**
 * NapCat 的启动脚本（来自 keeper 的配置）。
 * 用它可见窗口拉起：keeper 自己走的是「隐藏窗口 + wscript」，实测在这台机器上
 * 起不来（procs 全 0、launch.log 一行不涨），而交互式控制台里跑同一份 bat 就能起来。
 */
function napcatLauncher() {
  const config = keeperConfig()
  const shellDir = typeof config.shellDir === 'string' ? config.shellDir.trim() : ''
  const script = typeof config.launcherScript === 'string' ? config.launcherScript.trim() : ''
  if (script) return { cwd: shellDir || undefined, file: script }
  if (shellDir) {
    const guess = join(shellDir, 'start-napcat.bat')
    if (existsSync(guess)) return { cwd: shellDir, file: guess }
  }
  return null
}

/** Which profiles declare these packages? Read-only, best effort. */
function biliConfig() {
  const cfg = safeJson(join(dshHome(), 'bili-duty', 'config.json'), {})
  return cfg && typeof cfg === 'object' ? cfg : {}
}

/** 值班那个 profile 装了什么、默认模型是什么 —— 控制中心要能说清「用没有值班 profile 的模型会怎样」 */
function dutyProfileInfo() {
  const cfg = biliConfig()
  const name = String(cfg.headlessProfile || 'headless')
  const dir = join(dshHome(), 'profiles', name)
  const pkg = safeJson(join(dir, 'package.json'), null)
  const bundles = (pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
  let defaults = { provider: '', model: '' }
  try {
    const yml = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')
    const hit = /-\s*id:\s*agent-default-model[\s\S]{0,400}?provider:\s*['"]?([\w:.@-]+)['"]?[\s\S]{0,200}?model:\s*['"]?([\w:.@/-]+)['"]?/.exec(String(yml))
    if (hit) defaults = { provider: hit[1], model: hit[2] }
  } catch (ignored) {}
  return {
    profile: name,
    dir,
    exists: Boolean(pkg),
    bundles: bundles.map(String),
    dependencies: Object.keys((pkg && pkg.dependencies) || {}),
    defaults,
    hasHeadlessApp: bundles.map(String).includes('@deepseek-ai/dsh-headless'),
    duty: { provider: String(cfg.dutyProvider || ''), model: String(cfg.dutyModel || '') },
    dshBin: String(cfg.dshBin || ''),
  }
}

/** 写「值班那个 profile 的默认模型」：dump-config 会因此看见这条线路，开跑前的校验也就过了 */
function writeDutyDefault(provider, model) {
  const info = dutyProfileInfo()
  if (!info.exists) throw new Error('no-such-profile: ' + info.profile)
  const file = join(info.dir, 'cordis.patch.yml')
  let text = ''
  try { text = readFileSync(file, 'utf8') } catch (ignored) { text = '# 值班 profile 的 patch 层\n' }
  const block = /(^|\n)(-\s*id:\s*agent-default-model\b[\s\S]*?)(?=\n-\s|\s*$)/
  const lines = '- id: agent-default-model\n  config:\n    provider: ' + provider + '\n    model: ' + model
  if (block.test(text)) text = text.replace(block, function (_all, pre) { return pre + lines })
  else text = text.replace(/\s*$/, '') + '\n' + lines + '\n'
  if (!text.endsWith('\n')) text += '\n'
  try { if (!existsSync(file + '.bak')) writeFileSync(file + '.bak', readFileSync(file)) } catch (ignored) {}
  writeFileSync(file, text)
  return dutyProfileInfo()
}

/** 本文件所在目录（node_modules 里也是这个形状）—— 值班 CLI 包装器就住在旁边 */
function packageLibDir() {
  try { return dirname(fileURLToPath(import.meta.url)) } catch (ignored) { return join(dshHome(), 'companion') }
}

/** 值班 CLI 的配置（真 node 路径 + 真 dsh bin.js 路径），由控制中心的「修复」按钮写 */
/**
 * 值班 profile 必须自带 @deepseek-ai/dsh-headless 这个「一次性任务 app」。
 * 少了它，CLI 只挂 dsh-base、不读 task、不产出、不退出 —— 面板上就是「跑完不结束」。
 */
function fixDutyBundles() {
  const info = dutyProfileInfo()
  if (!info.exists) throw new Error('no-such-profile: ' + info.profile)
  if (info.hasHeadlessApp) return info
  const file = join(info.dir, 'package.json')
  const pkg = safeJson(file, null) || {}
  pkg.dsh = pkg.dsh && typeof pkg.dsh === 'object' ? pkg.dsh : {}
  pkg.dsh.profile = pkg.dsh.profile && typeof pkg.dsh.profile === 'object' ? pkg.dsh.profile : {}
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles.map(String) : []
  const next = bundles.includes('@deepseek-ai/dsh-headless') ? bundles : (bundles.includes('@deepseek-ai/dsh-base')
    ? bundles.flatMap(function (b) { return b === '@deepseek-ai/dsh-base' ? [b, '@deepseek-ai/dsh-headless'] : [b] })
    : ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', ...bundles])
  pkg.dsh.profile.bundles = next
  try { if (!existsSync(file + '.bak')) writeFileSync(file + '.bak', readFileSync(file)) } catch (ignored) {}
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
  return dutyProfileInfo()
}

function dutyCliConfigPath() { return join(dshHome(), 'companion', 'duty-cli.json') }
function dutyCliWrapperPath() { return join(packageLibDir(), 'duty-cli.js') }

function samePath(a, b) {
  const norm = function (p) { return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() }
  return Boolean(a) && Boolean(b) && norm(a) === norm(b)
}

/** 桌面版里 process.execPath 是 Electron 二进制，不能拿它跑 dsh CLI（运行时指纹表不认识它）⇒ 找一个真 node.exe */
function detectRealNode() {
  const fromEnv = String(process.env.DSH_COMPANION_NODE || '').trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  let out = ''
  try { out = String(spawnSync('cmd.exe', ['/c', 'where', 'node'], { encoding: 'utf8', windowsHide: true, timeout: 20000 }).stdout || '') } catch (ignored) {}
  for (const line of out.split(/\r?\n/)) {
    const p = line.trim()
    if (p && p !== process.execPath && existsSync(p)) return p
  }
  for (const p of ['C:/Program Files/nodejs/node.exe', 'D:/nodejs/node.exe', join(process.env.APPDATA || '', 'npm', 'node.exe')]) {
    if (p && existsSync(p)) return p
  }
  return ''
}

/** 找全局 dsh CLI 的 bin.js（优先沿用用户已经填过的那条路径） */
function detectDshBin(saved) {
  if (saved && existsSync(saved)) return saved
  let out = ''
  try { out = String(spawnSync('cmd.exe', ['/c', 'where', 'dsh'], { encoding: 'utf8', windowsHide: true, timeout: 20000 }).stdout || '') } catch (ignored) {}
  for (const line of out.split(/\r?\n/)) {
    const p = line.trim()
    if (!p) continue
    const guess = join(dirname(p), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (existsSync(guess)) return guess
  }
  const appdata = join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  return existsSync(appdata) ? appdata : ''
}

/** 值班 CLI 现在是什么状态：能直接跑，还是得走包装器 */
function dutyCliInfo() {
  const saved = safeJson(dutyCliConfigPath(), {}) || {}
  const cfg = biliConfig()
  const wrapper = dutyCliWrapperPath()
  const dshBin = String(cfg.dshBin || '')
  const electron = Boolean(process.versions && process.versions.electron)
  const usingWrapper = samePath(dshBin, wrapper)
  const needsRepair = electron && !usingWrapper && (!dshBin || /bin\.js$/i.test(dshBin))
  return {
    electron,
    execPath: String(process.execPath || ''),
    wrapper,
    wrapperExists: existsSync(wrapper),
    dshBin,
    usingWrapper,
    needsRepair,
    saved: { node: String(saved.node || ''), bin: String(saved.bin || ''), updatedAt: String(saved.updatedAt || '') },
    hint: needsRepair
      ? '桌面版的值班若直接用 dsh 的 bin.js，会被 Electron 运行时指纹挡住（0 秒 exit 1）—— 点「修复」改走真 node'
      : (usingWrapper ? '值班已经改走真 node，指纹问题不会再出现' : '当前 dsh 路径不是 bin.js，保持原样'),
  }
}

/** 修复：写一份 {node, bin} 给包装器，并把 bili-duty 的 dshBin 指向包装器 */
function repairDutyCli() {
  const wrapper = dutyCliWrapperPath()
  if (!existsSync(wrapper)) throw new Error('wrapper-missing: ' + wrapper)
  const cfg = biliConfig()
  const current = String(cfg.dshBin || '')
  const node = detectRealNode()
  if (!node) throw new Error('no-real-node: 没找到真的 node.exe（可用 DSH_COMPANION_NODE 指定）')
  const bin = detectDshBin(samePath(current, wrapper) ? String((safeJson(dutyCliConfigPath(), {}) || {}).bin || '') : current)
  if (!bin) throw new Error('no-dsh-cli: 没找到 @deepseek-ai/dsh/lib/bin.js（先装一个 npm 全局 dsh）')
  const payload = { node, bin, wrapper, updatedAt: new Date().toISOString() }
  try { mkdirSync(dirname(dutyCliConfigPath()), { recursive: true }) } catch (ignored) {}
  writeFileSync(dutyCliConfigPath(), JSON.stringify(payload, null, 2) + '\n')
  return { wrapper, node, bin }
}
function installedMap() {
  const result = {}
  for (const key of Object.keys(KNOWN)) result[key] = { installed: false, packages: [], profiles: [] }
  const profilesDir = join(dshHome(), 'profiles')
  let profiles = []
  try {
    profiles = readdirSync(profilesDir, { withFileTypes: true }).filter(function (item) { return item.isDirectory() }).map(function (item) { return item.name })
  } catch {
    return result
  }
  for (const profile of profiles) {
    const manifest = safeJson(join(profilesDir, profile, 'package.json'), null)
    if (!manifest) continue
    const deps = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) }
    for (const key of Object.keys(KNOWN)) {
      for (const pkg of KNOWN[key]) {
        if (deps[pkg]) {
          const entry = result[key]
          entry.installed = true
          if (entry.packages.indexOf(pkg) < 0) entry.packages.push(pkg)
          if (entry.profiles.indexOf(profile) < 0) entry.profiles.push(profile)
        }
      }
    }
  }
  return result
}

function animaStatus() {
  const dir = join(dshHome(), 'anima')
  const persona = safeJson(join(dir, 'persona.json'), null)
  const memory = safeJson(join(dir, 'memory.json'), null)
  const entries = memory && Array.isArray(memory.entries) ? memory.entries : []
  const counts = { pending: 0, approved: 0, rejected: 0 }
  for (const entry of entries) {
    if (entry.status === 'candidate') counts.pending += 1
    else if (entry.status === 'approved') counts.approved += 1
    else if (entry.status === 'rejected') counts.rejected += 1
  }
  return {
    ok: true,
    home: dir,
    exists: existsSync(dir),
    personaName: persona && persona.global && persona.global.name ? persona.global.name : null,
    counts: counts,
    endpoints: {
      status: '/anima/api/status',
      pending: '/anima/api/pending',
      decide: '/anima/api/decide',
      persona: '/anima/api/persona',
    },
  }
}

function memeStatus() {
  const packsDir = join(dshHome(), 'meme-packs')
  let packs = []
  try {
    packs = readdirSync(packsDir, { withFileTypes: true }).filter(function (item) { return item.isDirectory() }).map(function (item) { return item.name })
  } catch {}
  return { ok: true, packsDir: packsDir, packs: packs }
}

function buildStatus() {
  const installed = installedMap()
  const status = {
    generatedAt: new Date().toISOString(),
    home: dshHome(),
    branches: [
      { id: 'memory', title: '记忆', native: true, ready: installed.anima.installed, hint: installed.anima.installed ? '候选记忆在这里逐条裁决' : '需要安装 dsh-anima' },
      { id: 'qq', title: 'QQ', native: false, ready: installed.qq.installed, hint: installed.qq.installed ? '登录与人格实例在 QQ 机器人设置面板' : '需要安装 @zaofan/dsh-qqbot（web profile）' },
      { id: 'bili', title: 'B站', native: false, ready: installed.bili.installed, hint: installed.bili.installed ? '扫码登录与日报在 B站插件设置面板；写操作默认关闭' : '需要安装 dsh-bili-pond' },
      { id: 'meme', title: '表情包', native: false, ready: installed.meme.installed, hint: installed.meme.installed ? '图库管理在表情包设置面板' : '需要安装 dsh-meme' },
    ],
    services: installed,
  }
  try {
    status.anima = animaStatus()
  } catch (error) {
    status.anima = { ok: false, error: String(error && error.message ? error.message : error) }
  }
  try {
    status.meme = memeStatus()
  } catch (error) {
    status.meme = { ok: false, error: String(error && error.message ? error.message : error) }
  }
  return status
}

function readJsonBody(req, limit) {
  const cap = limit || 64 * 1024
  return new Promise(function (resolve) {
    let raw = ''
    let done = false
    function finish(value) {
      if (done) return
      done = true
      resolve(value)
    }
    req.on('data', function (chunk) {
      if (done) return
      raw += chunk
      if (raw.length > cap) {
        finish(null)
        try { req.destroy() } catch {}
      }
    })
    req.on('end', function () {
      if (!raw) return finish({})
      try { finish(JSON.parse(raw)) } catch { finish(null) }
    })
    req.on('error', function () { finish(null) })
  })
}

// 模型目录：只读 llm 注册表 + agentDefaultModel 的当前选择；都拿不到就退化，不抛错。
async function buildModelCatalog(ctx) {
  const out = { current: null, groups: [], failures: [], routableProviders: [], canSave: false, llm: false }
  const defaultModel = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
  if (defaultModel && typeof defaultModel.currentSelection === 'function') {
    try { out.current = defaultModel.currentSelection() } catch { out.current = null }
  }
  out.canSave = !!(defaultModel && typeof defaultModel.saveSelection === 'function')
  const llm = typeof ctx.get === 'function' ? ctx.get('llm') : null
  if (!llm || typeof llm.listProviders !== 'function') return out
  out.llm = true
  let providers = []
  try { providers = llm.listProviders() || [] } catch { return out }
  for (const provider of providers) {
    try {
      const models = await llm.listModels(provider.id)
      const entries = []
      for (const model of models || []) {
        let reasoning
        try {
          const info = await llm.resolveModelInfo(provider.id, model.id)
          if (info && info.reasoning) {
            reasoning = {
              efforts: (info.reasoning.efforts || []).map(function (effort) {
                return { id: effort.id, name: effort.name || effort.id }
              }),
              defaultEffort: info.reasoning.defaultEffort,
            }
          }
        } catch {}
        entries.push({
          id: model.id,
          name: model.name || model.id,
          ...(reasoning ? { reasoning: reasoning } : {}),
        })
      }
      if (entries.length > 0) {
        out.groups.push({ id: provider.id, name: provider.name || provider.id, models: entries })
      }
    } catch (error) {
      out.failures.push({
        id: provider.id,
        name: provider.name || provider.id,
        message: String((error && error.message) || error),
      })
    }
  }
  out.routableProviders = out.groups.map(function (group) { return group.id })
  return out
}

function findModel(groups, provider, model) {
  const group = (groups || []).filter(function (item) { return item.id === provider })[0]
  if (!group) return null
  return group.models.filter(function (item) { return item.id === model })[0] || null
}

function sameSelection(a, b) {
  if (!a || !b) return false
  return a.provider === b.provider && a.model === b.model && (a.reasoningEffort || '') === (b.reasoningEffort || '')
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function isLoopback(address) {
  const raw = String(address || '')
  return raw === '::1' || raw === '127.0.0.1' || raw.startsWith('127.') || raw === 'localhost' || raw === '::ffff:127.0.0.1'
}

/** 主人号 / 朋友号 / 主动互动设置：本插件自己的文件，不动 onebot 的 profile patch。 */
function companionPath() { return join(dshHome(), 'companion', 'settings.json') }

const DEFAULT_OPENERS = [
  '在忙吗？突然想跟你说句话。',
  '这个点你在干嘛呢？',
  '我刚想到个事，等你空了一起说。',
  '喝口水吧，别一直盯着屏幕。',
  '今天过得怎么样？',
]

function normalizeIds(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const raw of value) {
    const id = String(raw === null || raw === undefined ? '' : raw).trim()
    if (/^\d{5,12}$/.test(id) && out.indexOf(id) < 0) out.push(id)
  }
  return out
}

function intIn(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** 允许主动互动的星期：1=周一 … 7=周日（用户口语「周1234567」）。空数组按全周算，避免清空后静默不发。 */
function normalizeDays(value) {
  const list = Array.isArray(value) ? value : []
  const seen = new Set()
  for (const item of list) {
    const n = Math.floor(Number(item))
    if (Number.isFinite(n) && n >= 1 && n <= 7) seen.add(n)
  }
  const out = Array.from(seen).sort(function (a, b) { return a - b })
  return out.length > 0 ? out : [1, 2, 3, 4, 5, 6, 7]
}

function inActiveDay(cfg, date) {
  const day = date.getDay() === 0 ? 7 : date.getDay()
  return normalizeDays(cfg.proactive.days).includes(day)
}

function readCompanion() {
  const raw = safeJson(companionPath(), {})
  const root = raw && typeof raw === 'object' ? raw : {}
  const p = root.proactive && typeof root.proactive === 'object' ? root.proactive : {}
  const dp = p.dutyPush && typeof p.dutyPush === 'object' ? p.dutyPush : {}
  const pd = p.pond && typeof p.pond === 'object' ? p.pond : {}
  return {
    owners: normalizeIds(root.owners),
    friends: normalizeIds(root.friends),
    proactive: {
      enabled: p.enabled === true,
      useModel: p.useModel === true,
      intervalMinutes: intIn(p.intervalMinutes, 10, 720, 90),
      windowStart: intIn(p.windowStart, 0, 23, 9),
      windowEnd: intIn(p.windowEnd, 0, 23, 23),
      days: normalizeDays(p.days),
      pool: Array.isArray(p.pool) ? p.pool.map(function (x) { return String(x).trim() }).filter(function (x) { return x !== '' }).slice(0, 20) : [],
      lastSentAt: Number.isFinite(Number(p.lastSentAt)) ? Number(p.lastSentAt) : 0,
      lastError: typeof p.lastError === 'string' ? p.lastError : '',
      dutyPush: {
        enabled: dp.enabled !== false,
        maxItems: intIn(dp.maxItems, 1, 5, 2),
        cooldownMinutes: intIn(dp.cooldownMinutes, 5, 720, 30),
        lastKey: typeof dp.lastKey === 'string' ? dp.lastKey : '',
        lastAt: Number.isFinite(Number(dp.lastAt)) ? Number(dp.lastAt) : 0,
        lastText: typeof dp.lastText === 'string' ? dp.lastText : '',
      },
      pond: {
        gate: pd.gate === true,
        days: normalizeDays(pd.days),
        parked: pd.parked === true,
        parkedAt: Number.isFinite(Number(pd.parkedAt)) ? Number(pd.parkedAt) : 0,
        lastError: typeof pd.lastError === 'string' ? pd.lastError : '',
      },
    },
  }
}

function writeCompanion(next) {
  const file = companionPath()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

function saveCompanion(patch) {
  const cur = readCompanion()
  const body = patch && typeof patch === 'object' ? patch : {}
  const next = { owners: body.owners === undefined ? cur.owners : normalizeIds(body.owners), friends: body.friends === undefined ? cur.friends : normalizeIds(body.friends), proactive: Object.assign({}, cur.proactive, { dutyPush: Object.assign({}, cur.proactive.dutyPush), pond: Object.assign({}, cur.proactive.pond) }) }
  const p = body.proactive && typeof body.proactive === 'object' ? body.proactive : {}
  if (p.enabled !== undefined) next.proactive.enabled = p.enabled === true
  if (p.useModel !== undefined) next.proactive.useModel = p.useModel === true
  if (p.intervalMinutes !== undefined) next.proactive.intervalMinutes = intIn(p.intervalMinutes, 10, 720, cur.proactive.intervalMinutes)
  if (p.windowStart !== undefined) next.proactive.windowStart = intIn(p.windowStart, 0, 23, cur.proactive.windowStart)
  if (p.windowEnd !== undefined) next.proactive.windowEnd = intIn(p.windowEnd, 0, 23, cur.proactive.windowEnd)
  if (Array.isArray(p.days)) next.proactive.days = normalizeDays(p.days)
  if (Array.isArray(p.pool)) next.proactive.pool = p.pool.map(function (x) { return String(x).trim() }).filter(function (x) { return x !== '' }).slice(0, 20)
  if (p.lastSentAt !== undefined) next.proactive.lastSentAt = Number(p.lastSentAt) || 0
  if (p.lastError !== undefined) next.proactive.lastError = String(p.lastError)
  const d = p.dutyPush && typeof p.dutyPush === 'object' ? p.dutyPush : {}
  if (d.enabled !== undefined) next.proactive.dutyPush.enabled = d.enabled === true
  if (d.maxItems !== undefined) next.proactive.dutyPush.maxItems = intIn(d.maxItems, 1, 5, cur.proactive.dutyPush.maxItems)
  if (d.cooldownMinutes !== undefined) next.proactive.dutyPush.cooldownMinutes = intIn(d.cooldownMinutes, 5, 720, cur.proactive.dutyPush.cooldownMinutes)
  const pd = p.pond && typeof p.pond === 'object' ? p.pond : {}
  if (pd.gate !== undefined) next.proactive.pond.gate = pd.gate === true
  if (Array.isArray(pd.days)) next.proactive.pond.days = normalizeDays(pd.days)
  if (pd.parked !== undefined) next.proactive.pond.parked = pd.parked === true
  if (pd.parkedAt !== undefined) next.proactive.pond.parkedAt = Number(pd.parkedAt) || 0
  if (pd.lastError !== undefined) next.proactive.pond.lastError = String(pd.lastError)
  return writeCompanion(next)
}

function inWindow(cfg, date) {
  const hour = date.getHours()
  const a = cfg.proactive.windowStart
  const b = cfg.proactive.windowEnd
  return a <= b ? hour >= a && hour < b : hour >= a || hour < b
}

function nextDueAt(cfg) {
  if (!cfg.proactive.enabled || cfg.owners.length === 0) return 0
  return cfg.proactive.lastSentAt > 0 ? cfg.proactive.lastSentAt + cfg.proactive.intervalMinutes * 60000 : Date.now()
}

function pickOpener(cfg, date) {
  const pool = cfg.proactive.pool.length > 0 ? cfg.proactive.pool : DEFAULT_OPENERS
  return pool[Math.floor(date.getTime() / 60000) % pool.length]
}

/** 主动消息文案：默认本地模板（不烧额度）；开了 useModel 才问一次模型，失败回落到模板。 */
async function composeProactive(ctx, cfg) {
  if (!cfg.proactive.useModel) return { text: pickOpener(cfg, new Date()), source: 'template' }
  try {
    const llm = typeof ctx.get === 'function' ? ctx.get('llm') : null
    const pin = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : null
    const sel = pin && typeof pin.currentSelection === 'function' ? pin.currentSelection() : null
    if (!llm || typeof llm.stream !== 'function' || !sel || !sel.provider || !sel.model) throw new Error('llm 或默认模型不可用')
    const mod = await import('@deepseek-ai/dsh-llm')
    const assembler = new mod.BlockAssembler()
    const prompt = '现在是 ' + new Date().toLocaleString('zh-CN') + '。给主人发一条主动消息：一到两句，口语，别用列表，别提这次是定时任务。'
    const stream = llm.stream({
      provider: sel.provider,
      model: sel.model,
      system: '你在给主人发一条主动问候。只输出要发的那一两句。',
      messages: [mod.createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'dsh-companion-dashboard' } })],
      maxTokens: 160,
      purpose: 'companion-proactive',
    })
    for await (const chunk of stream) assembler.push(chunk)
    const text = assembler.blocks().filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string' }).map(function (b) { return b.text }).join('').trim()
    if (text === '') throw new Error('模型没有输出文字')
    return { text: text, source: 'model' }
  } catch (error) {
    return { text: pickOpener(cfg, new Date()), source: 'template', note: String((error && error.message) || error) }
  }
}

async function runProactive(ctx, opts) {
  const cfg = readCompanion()
  const wanted = opts && opts.chatId ? String(opts.chatId) : ''
  const chatId = wanted !== '' ? wanted : cfg.owners.length > 0 ? 'private:' + cfg.owners[0] : ''
  if (chatId === '') throw new Error('还没有设置主人号')
  const built = await composeProactive(ctx, cfg)
  const ids = await sendText(chatId, built.text)
  cfg.proactive.lastSentAt = Date.now()
  cfg.proactive.lastError = ''
  writeCompanion(cfg)
  return { chatId: chatId, text: built.text, source: built.source, note: built.note || '', ids: ids }
}
// ---- 值班摘要推送：这一轮值班想说的话 + 最值得的 2 条，成段一条发到 QQ（不分句） ----

/** 值班数据目录：优先 bili-duty 设置里的 home，其次 <DSH_HOME>/bili-duty。 */
function dutyHome() {
  const cfg = biliConfig()
  const custom = typeof cfg.home === 'string' && cfg.home.trim() !== '' ? cfg.home.trim() : ''
  return custom !== '' ? custom : join(dshHome(), 'bili-duty')
}

/** 把任何话压成一条不分句的纯文本（QQ 分句是按 。！？ 和换行切的，成段推送要绕开它）。 */
function flattenMessage(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/[\r\n]+/g, '，')
    .replace(/[。！？!?…]+/g, '，')
    .replace(/，{2,}/g, '，')
    .replace(/^，|，$/g, '')
    .trim()
}

/** 读值班留下的三样信号：say.txt 一句话、memory.jsonl 的「值得跨天记住」条目、以及它们的轮次指纹。 */
function readDutySignals() {
  const dir = dutyHome()
  const sayFile = join(dir, 'say.txt')
  let say = ''
  let sayStamp = 0
  try {
    if (existsSync(sayFile)) {
      say = readFileSync(sayFile, 'utf8').trim()
      sayStamp = statSync(sayFile).mtimeMs
    }
  } catch (ignored) {}
  const rows = []
  try {
    for (const line of readFileSync(join(dir, 'memory.jsonl'), 'utf8').split('\n')) {
      const text = line.trim()
      if (text === '') continue
      try {
        const row = JSON.parse(text)
        if (row && row.t) rows.push({ text: String(row.t), why: String(row.why || ''), bv: String(row.bv || ''), date: String(row.d || '') })
      } catch (ignored) {}
    }
  } catch (ignored) {}
  const tail = rows.slice(-5)
  const key = rows.length + '|' + sayStamp + '|' + (rows.length > 0 ? rows[rows.length - 1].text.slice(0, 24) : '')
  return { dir: dir, say: say, items: tail, rows: rows.length, key: key }
}

/** 取最近 max 条、同一个 BV 只留一条。 */
function pickDutyItems(signals, max) {
  const limit = intIn(max, 1, 5, 2)
  const seen = []
  const out = []
  for (let i = signals.items.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const row = signals.items[i]
    if (row.bv && seen.indexOf(row.bv) >= 0) continue
    if (row.bv) seen.push(row.bv)
    out.unshift(row)
  }
  return out
}

/** 推送文案：一句鱼说 + 最多 max 条（标题 + 一句话理由 + 链接），整段不带句末标点。 */
function composeDutyMessage(signals, max) {
  const items = pickDutyItems(signals, max)
  const parts = []
  const say = flattenMessage(signals.say)
  parts.push(say !== '' ? '值班刚跑完，就一句：' + say : '值班刚跑完')
  if (items.length > 0) {
    parts.push('这一轮值得你看的 ' + items.length + ' 条')
    items.forEach(function (row, index) {
      const num = '①②③④⑤'[index] || String(index + 1)
      const why = flattenMessage(row.why).slice(0, 60)
      const link = row.bv ? ' https://www.bilibili.com/video/' + row.bv : ''
      parts.push(num + ' ' + flattenMessage(row.text).slice(0, 80) + (why !== '' ? '（' + why + '）' : '') + link)
    })
  } else {
    parts.push('这次没有新的值得看的')
  }
  return parts.join(' · ')
}

/** 该不该推：开关 + 主人号 + 时段 + 有新轮次 + 冷却。 */
function dutyPushDue(cfg, signals, date) {
  const dp = cfg.proactive.dutyPush
  if (!dp.enabled) return { due: false, why: 'disabled' }
  if (cfg.owners.length === 0) return { due: false, why: 'no-owner' }
  if (!inActiveDay(cfg, date)) return { due: false, why: 'outside-day' }
  if (!inWindow(cfg, date)) return { due: false, why: 'outside-window' }
  if (!signals.key || (signals.items.length === 0 && signals.say === '')) return { due: false, why: 'nothing-new' }
  if (signals.key === dp.lastKey) return { due: false, why: 'already-pushed' }
  if (dp.lastAt > 0 && date.getTime() - dp.lastAt < dp.cooldownMinutes * 60000) return { due: false, why: 'cooling' }
  return { due: true }
}

/** 真的推一条：整段发送（绕过按句分条），成功后记住这一轮的 key。 */
async function runDutyPush(ctx, opts) {
  const cfg = readCompanion()
  const wanted = opts && opts.chatId ? String(opts.chatId) : ''
  const chatId = wanted !== '' ? wanted : cfg.owners.length > 0 ? 'private:' + cfg.owners[0] : ''
  if (chatId === '') throw new Error('还没有设置主人号')
  const signals = readDutySignals()
  if (signals.items.length === 0 && signals.say === '') throw new Error('值班还没有留下 say.txt 或 memory.jsonl：先跑一轮值班')
  const force = !!(opts && opts.force)
  if (!force) {
    const verdict = dutyPushDue(cfg, signals, new Date())
    if (!verdict.due) return { skipped: verdict.why, key: signals.key, chatId: chatId }
  }
  const text = composeDutyMessage(signals, cfg.proactive.dutyPush.maxItems)
  const ids = await sendOneMessage(chatId, text)
  cfg.proactive.dutyPush.lastKey = signals.key
  cfg.proactive.dutyPush.lastAt = Date.now()
  cfg.proactive.dutyPush.lastText = text
  writeCompanion(cfg)
  return { chatId: chatId, text: text, key: signals.key, items: pickDutyItems(signals, cfg.proactive.dutyPush.maxItems).length, ids: ids }
}
export function apply(ctx, pluginConfig) {
  const config = pluginConfig || {}
  const allowLan = config.allowLan === true
  const webServer = ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : null) || null

  // QQ 长回复分句：接管 dsh-onebot-qq 的出站原型，超长按句号切条（没装/结构变了就跳过）
  // HMR 重新挂载 onebot 时可能换成新的模块实例（原型补丁随之丢失），所以装完定期复查，幂等自愈
  function armQqSplit(first) {
    installQqSplit().then(function (info) {
      if (!info.ok) {
        if (first) console.log('[dsh-companion-dashboard] QQ 分句: 未接管（' + (info.reason || 'unknown') + '）')
        return
      }
      if (info.reason === 'already-installed') return
      console.log('[dsh-companion-dashboard] QQ 分句: 已接管，每条 ≤ ' + info.chunks + ' 字（按句号切）')
    }).catch(function (error) {
      console.log('[dsh-companion-dashboard] QQ 分句接管失败: ' + String(error && error.message ? error.message : error))
    })
  }
  armQqSplit(true)
  const qqSplitTimer = setInterval(function () { armQqSplit(false) }, 60000)
  if (qqSplitTimer && typeof qqSplitTimer.unref === 'function') qqSplitTimer.unref()

  // QQ 出站媒体围栏：把表情包库（<DSH_HOME>/meme-packs）也放行，否则访客回合发图必被拒
  // 同样定期复查：HMR 重挂 onebot 会换模块实例，原型补丁要重新打
  function armMediaRoots(first) {
    installMediaRoots().then(function (info) {
      if (!info.ok) {
        if (first) console.log('[dsh-companion-dashboard] 媒体围栏: 未接管（' + (info.reason || 'unknown') + '）')
        return
      }
      if (info.reason === 'already-installed') return
      console.log('[dsh-companion-dashboard] 媒体围栏: 已放行 ' + info.roots.length + ' 个附加目录' + (info.roots.length ? '（' + info.roots.join('; ') + '）' : ''))
    }).catch(function (error) {
      console.log('[dsh-companion-dashboard] 媒体围栏接管失败: ' + String(error && error.message ? error.message : error))
    })
  }
  armMediaRoots(true)
  const mediaRootsTimer = setInterval(function () { armMediaRoots(false) }, 60000)
  if (mediaRootsTimer && typeof mediaRootsTimer.unref === 'function') mediaRootsTimer.unref()

  // QQ 聊天模型：每个聊天在创建时把当时的部署默认拍进 selectionRef
  // （dsh-onebot-qq/lib/registry.js:85-96），之后改部署默认对它无效。
  // 这里 patch ChatRegistry.prototype.createChatAgent，把聊天表记下来，
  // 好在控制台切模型时把新选择下发到每个聊天（等价于各聊天分别发一次 /model）。
  function armChatModel(first) {
    installChatModel().then(function (info) {
      if (!info.ok) {
        if (first) console.log('[dsh-companion-dashboard] QQ 聊天模型: 未接管（' + (info.reason || 'unknown') + '）')
        return
      }
      if (info.reason === 'already-installed') return
      console.log('[dsh-companion-dashboard] QQ 聊天模型: 已接管（切换模型会同步下发到各聊天）')
    }).catch(function (error) {
      console.log('[dsh-companion-dashboard] QQ 聊天模型接管失败: ' + String(error && error.message ? error.message : error))
    })
  }
  armChatModel(true)
  const chatModelTimer = setInterval(function () { armChatModel(false) }, 60000)
  if (chatModelTimer && typeof chatModelTimer.unref === 'function') chatModelTimer.unref()

  // 鱼塘排班闸门：鱼塘自己的 tick 是闭包，外部只有「每 60s 重读配置」这一个杠杆。
  // 所以这里做「停放 / 归还」：非排班日关掉它、排班日还回开，本来就关着的一动不动。
  function enforcePondGate(cfg) {
    const pond = cfg.proactive.pond
    if (!pond.gate) return null
    const outcome = applyPondGate({ days: pond.days, parked: pond.parked })
    if (!outcome.ok) {
      if (pond.lastError !== outcome.error) saveCompanion({ proactive: { pond: { lastError: String(outcome.error || '') } } })
      return outcome
    }
    if (outcome.changed) {
      saveCompanion({ proactive: { pond: { parked: outcome.parked === true, parkedAt: outcome.parked ? Date.now() : 0, lastError: '' } } })
      console.log('[dsh-companion-dashboard] 鱼塘自动运行' + (outcome.parked ? '已按排班暂停' : '已按排班恢复') + '（' + outcome.why + '）')
    } else if (pond.lastError !== '') {
      saveCompanion({ proactive: { pond: { lastError: '' } } })
    }
    return outcome
  }

  // 每 60s 看一次：先问「该主动打个招呼了吗」，再问「值班有新的值得说的吗」
  let proactiveBusy = false
  const proactiveTimer = setInterval(function () {
    if (proactiveBusy) return
    const cfg = readCompanion()
    const now = new Date()
    try { enforcePondGate(cfg) } catch (error) {
      console.log('[dsh-companion-dashboard] 鱼塘排班闸门失败: ' + String((error && error.message) || error))
    }
    if (cfg.proactive.enabled && cfg.owners.length > 0 && inActiveDay(cfg, now) && inWindow(cfg, now) && Date.now() >= nextDueAt(cfg)) {
      proactiveBusy = true
      runProactive(ctx, {}).then(function (info) {
        console.log('[dsh-companion-dashboard] 主动互动已发送: ' + info.text)
      }).catch(function (error) {
        const latest = readCompanion()
        latest.proactive.lastError = String((error && error.message) || error)
        try { writeCompanion(latest) } catch (ignored) {}
        console.log('[dsh-companion-dashboard] 主动互动失败: ' + latest.proactive.lastError)
      }).then(function () { proactiveBusy = false })
      return
    }
    if (!dutyPushDue(cfg, readDutySignals(), now).due) return
    proactiveBusy = true
    runDutyPush(ctx, { force: false }).then(function (info) {
      console.log('[dsh-companion-dashboard] 值班摘要已推送: ' + info.text)
    }).catch(function (error) {
      console.log('[dsh-companion-dashboard] 值班摘要推送失败: ' + String((error && error.message) || error))
    }).then(function () { proactiveBusy = false })
  }, 60000)
  if (proactiveTimer && typeof proactiveTimer.unref === 'function') proactiveTimer.unref()
  if (!webServer || typeof webServer.register !== 'function') {
    console.log('[dsh-companion-dashboard] webServer 不可用，状态接口未注册')
    return
  }

  console.log('[dsh-companion-dashboard] 已挂载: GET ' + ROUTE + '/status, GET ' + ROUTE + '/combos, GET ' + ROUTE + '/duty, POST ' + ROUTE + '/duty/default, GET|POST ' + ROUTE + '/model, GET ' + ROUTE + '/napcat/qr, POST ' + ROUTE + '/napcat/start, GET|POST ' + ROUTE + '/interact, POST ' + ROUTE + '/interact/send（duty:true = 现推一条值班摘要）, GET ' + ROUTE + '/media-roots, GET|POST ' + ROUTE + '/pond-gate')

  ctx.effect(function () {
    return disposeLiveSelections
  })

  ctx.effect(function () {
    return webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: function (req, res) {
        if (!allowLan && !isLoopback(req.socket ? req.socket.remoteAddress : '')) {
          return sendJson(res, 403, { ok: false, error: 'loopback-only' })
        }
        const pathname = String(req.url || '').split('?')[0].slice(ROUTE.length) || '/'
        if (req.method === 'GET' && (pathname === '/status' || pathname === '/')) {
          try {
            return sendJson(res, 200, { ok: true, data: buildStatus() })
          } catch (error) {
            return sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        }
        if (req.method === 'POST' && pathname === '/napcat/start') {
          // 可见窗口拉起：与手动双击 start-napcat.bat 等价，这是唯一实测能起来的方式
          const launcher = napcatLauncher()
          if (!launcher) return sendJson(res, 400, { ok: false, error: 'no-launcher' })
          try {
            const child = spawn('cmd.exe', ['/c', 'start', '', launcher.file], {
              cwd: launcher.cwd,
              detached: true,
              stdio: 'ignore',
              windowsHide: false,
            })
            child.unref()
            return sendJson(res, 200, { ok: true, data: { spawned: launcher.file } })
          } catch (error) {
            return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
          }
        }
        if (req.method === 'GET' && pathname === '/napcat/qr') {
          // 二维码原样透传：浏览器半只认 URL，不碰宿主文件系统
          const file = napcatQrFile()
          if (!file) return sendJson(res, 404, { ok: false, error: 'no-qr' })
          try {
            const buf = readFileSync(file)
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Cache-Control': 'no-store',
              'Content-Length': String(buf.length),
            })
            return res.end(buf)
          } catch (error) {
            return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
          }
        }
        if (pathname === '/pond-gate') {
          if (req.method === 'GET') {
            return sendJson(res, 200, { ok: true, data: pondGateStatus(readCompanion().proactive.pond) })
          }
          if (req.method === 'POST') {
            return readJsonBody(req).then(function (body) {
              if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'bad-json' })
              const patch = {}
              if (body.gate !== undefined) patch.gate = body.gate === true
              if (Array.isArray(body.days)) patch.days = body.days
              saveCompanion({ proactive: { pond: patch } })
              const cfg = readCompanion()
              const outcome = cfg.proactive.pond.gate ? enforcePondGate(cfg) : null
              return sendJson(res, 200, { ok: true, data: Object.assign({}, pondGateStatus(readCompanion().proactive.pond), { outcome: outcome }) })
            }).catch(function (error) {
              return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
            })
          }
          return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        }
        if (req.method === 'GET' && pathname === '/duty') {
          try {
            return sendJson(res, 200, { ok: true, data: dutyProfileInfo() })
          } catch (error) {
            return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
          }
        }
        if (req.method === 'POST' && pathname === '/duty/default') {
          // 值班「跟随 profile 默认」时 agent-default-model 是唯一生效点；写它还能让 dump-config
          // 看见这条线路，绕过 B站 插件「探测不到就拒绝开跑」那条假阴性。
          return readJsonBody(req).then(function (body) {
            if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'bad-json' })
            const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
            const model = typeof body.model === 'string' ? body.model.trim() : ''
            if (!provider || !model) return sendJson(res, 400, { ok: false, error: 'provider-and-model-required' })
            try {
              const info = writeDutyDefault(provider, model)
              return sendJson(res, 200, { ok: true, data: info })
            } catch (error) {
              return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
            }
          })
        }
        if (req.method === 'POST' && pathname === '/duty/bundles') {
          try {
            return sendJson(res, 200, { ok: true, data: fixDutyBundles() })
          } catch (error) {
            return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
          }
        }
        if (req.method === 'GET' && pathname === '/duty/cli') {
          try {
            return sendJson(res, 200, { ok: true, data: dutyCliInfo() })
          } catch (error) {
            return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
          }
        }
        if (req.method === 'POST' && pathname === '/duty/cli') {
          try {
            const fixed = repairDutyCli()
            return sendJson(res, 200, { ok: true, data: Object.assign({}, dutyCliInfo(), fixed) })
          } catch (error) {
            return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
          }
        }
        if (req.method === 'GET' && pathname === '/combos') {
          return sendJson(res, 200, { ok: true, data: { combos: comboCards(), path: join(dshHome(), 'our-free-model', 'settings.json') } })
        }
        if (req.method === 'GET' && pathname === '/model') {
          return buildModelCatalog(ctx)
            .then(function (catalog) {
              catalog.chatModel = chatModelStatus(currentBridge())
              sendJson(res, 200, { ok: true, data: catalog })
            })
            .catch(function (error) {
              sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
            })
        }
        if (req.method === 'POST' && pathname === '/model') {
          // 切换默认模型：写的是 agentDefaultModel 的配置行（configEditor 会落进 profile patch）
          return readJsonBody(req).then(function (body) {
            if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'bad-json' })
            const provider = typeof body.provider === 'string' ? body.provider.trim() : ''
            const model = typeof body.model === 'string' ? body.model.trim() : ''
            if (!provider || !model) return sendJson(res, 400, { ok: false, error: 'provider-and-model-required' })
            const effort = typeof body.reasoningEffort === 'string' && body.reasoningEffort.trim() !== ''
              ? body.reasoningEffort.trim()
              : undefined
            return buildModelCatalog(ctx).then(async function (catalog) {
              if (!catalog.canSave) return sendJson(res, 409, { ok: false, error: 'agentDefaultModel-unavailable' })
              if (!findModel(catalog.groups, provider, model)) {
                return sendJson(res, 404, { ok: false, error: 'unknown-model', provider: provider, model: model })
              }
              const next = { provider: provider, model: model, ...(effort ? { reasoningEffort: effort } : {}) }
              try {
                const defaultModel = ctx.get('agentDefaultModel')
                await defaultModel.saveSelection(next)
                const after = typeof defaultModel.currentSelection === 'function' ? defaultModel.currentSelection() : null
                const hotSwitch = await hotSwitchLiveAgents(ctx, next)
                // 再把新选择写进每个 QQ 聊天的 selectionRef（等价于各聊天发一次 /model），
                // 否则已存在的聊天会一直用创建时快照的旧模型
                const chatSwitch = retargetLiveChats(currentBridge(), next)
                sendJson(res, 200, {
                  ok: true,
                  data: {
                    saved: sameSelection(after, next),
                    current: after,
                    requested: next,
                    hotSwitch: hotSwitch,
                    chatSwitch: chatSwitch,
                    note: sameSelection(after, next) ? '' : 'saveSelection 没有落盘（部署缺 configEditor 时正常）',
                  },
                })
              } catch (error) {
                sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
              }
            })
          })
        }
        if (pathname === '/media-roots' && req.method === 'GET') {
      const status = mediaRootsStatus()
      sendJson(res, 200, { ok: true, roots: status.roots, count: status.count, memeDir: extraMediaRoots()[0] || '', inline: memeInlineStatus() })
      return
    }
    if (pathname === '/interact' && req.method === 'GET') {
          const cfg = readCompanion()
          const signals = readDutySignals()
          const duty = {
            dir: signals.dir,
            say: signals.say,
            items: pickDutyItems(signals, cfg.proactive.dutyPush.maxItems),
            key: signals.key,
            pending: dutyPushDue(cfg, signals, new Date()),
            preview: composeDutyMessage(signals, cfg.proactive.dutyPush.maxItems),
            lastKey: cfg.proactive.dutyPush.lastKey,
            lastAt: cfg.proactive.dutyPush.lastAt,
            lastText: cfg.proactive.dutyPush.lastText,
          }
          return sendJson(res, 200, { ok: true, data: Object.assign({}, cfg, { nextDueAt: nextDueAt(cfg), outbound: outboundStatus(), duty: duty }) })
        }
        if (pathname === '/interact' && req.method === 'POST') {
          return readJsonBody(req).then(function (body) {
            if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'bad-json' })
            try {
              const cfg = saveCompanion(body)
              return sendJson(res, 200, { ok: true, data: Object.assign({}, cfg, { nextDueAt: nextDueAt(cfg), outbound: outboundStatus() }) })
            } catch (error) {
              return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
            }
          })
        }
        if (pathname === '/interact/send' && req.method === 'POST') {
          return readJsonBody(req).then(function (body) {
            const chatId = body && typeof body.chatId === 'string' ? body.chatId.trim() : ''
            const duty = body && body.duty === true
            const task = duty ? runDutyPush(ctx, { chatId: chatId, force: body && body.force === true }) : runProactive(ctx, { chatId: chatId })
            return task.then(function (info) {
              return sendJson(res, 200, { ok: true, data: info })
            }).catch(function (error) {
              const why = String((error && error.message) || error)
              // 前置条件不满足（没配主人号 / 出站管道还没捕获 / 值班没产出）是调用方的错，别报成服务端故障
              return sendJson(res, /还没有设置主人号|出站管道|值班还没有留下/.test(why) ? 400 : 500, { ok: false, error: why })
            })
          })
        }
        return sendJson(res, 404, { ok: false, error: 'unknown route', path: pathname })
      },
    })
  })
}

export { buildStatus, readCompanion, saveCompanion, writeCompanion, composeProactive, runProactive, readDutySignals, pickDutyItems, composeDutyMessage, dutyPushDue, runDutyPush, nextDueAt, inWindow, inActiveDay, normalizeDays, buildModelCatalog, findModel, dutyProfileInfo, writeDutyDefault, fixDutyBundles, dutyCliInfo, repairDutyCli, detectRealNode, detectDshBin, napcatQrFile, napcatLauncher, comboCards, hotSwitchLiveAgents, disposeLiveSelections, installChatModel, chatModelStatus, retargetLiveChats, currentBridge, memeInlineStatus, applyPondGate, pondGateStatus, pondGateDir }
