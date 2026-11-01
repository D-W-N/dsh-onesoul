/**
 * dsh-companion-dashboard —— 鱼塘排班闸门（Host 半的辅助模块）。
 *
 * 为什么要有这个文件：dsh-bili-pond 的自动运行只有「总开关 + 每天轮数 + 间隔 + 峰谷窗口」，
 * 没有星期维度；它的 tick 是 apply() 里的闭包，外面拿不到也 patch 不了。
 * 能拿到的唯一杠杆是它自己每 60 秒重读一次的配置：
 *   <DSH_HOME>/bili-duty/config.json          ← 每个 tick 都会 refreshCfg() 重读
 *   <DSH_HOME>/bili-duty/local-override.json  ← 记录「从插件面板存过的键」= 本地优先
 * 所以这里的做法是「停放 / 归还」，不是「强行打开」：
 *   · 非排班日且鱼塘自动运行是开着的 ⇒ 关掉，并记下是我们关的（parked）
 *   · 排班日且是我们关的            ⇒ 还回开
 *   · 本来就是关的                  ⇒ 一律不动（绝不替用户打开他从没开过的东西）
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function pondDir() { return join(dshHome(), 'bili-duty') }
export function pondConfigPath() { return join(pondDir(), 'config.json') }
export function pondOverridePath() { return join(pondDir(), 'local-override.json') }

function readJsonFile(path, fallback) {
  try {
    if (!existsSync(path)) return fallback
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch (error) {
    return fallback
  }
}

function writeJsonFile(path, value) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf8')
  return value
}

/** 星期归一：1=周一 … 7=周日；空/非法一律按全周。 */
export function normalizeDays(value) {
  const list = Array.isArray(value) ? value : []
  const seen = new Set()
  for (const item of list) {
    const n = Math.floor(Number(item))
    if (Number.isFinite(n) && n >= 1 && n <= 7) seen.add(n)
  }
  const out = Array.from(seen).sort(function (a, b) { return a - b })
  return out.length > 0 ? out : ALL_DAYS.slice()
}

/** date 落在排班日里吗（周日 local getDay()=0，这里折算成 7）。 */
export function dayAllowed(days, date) {
  const day = date.getDay() === 0 ? 7 : date.getDay()
  return normalizeDays(days).includes(day)
}

export function readPondConfig() { return readJsonFile(pondConfigPath(), {}) }

/** 鱼塘现在这一份配置里 autoRun 是什么（读不到就是 false，和它的默认值一致）。 */
export function pondAutoRun() {
  const cfg = readPondConfig()
  return cfg.autoRun === true
}

/**
 * 让 autoRun 在这个键上「本地优先」。
 * 鱼塘的 loadCfg() 对 local-override.json 里出现过的键一律以 config.json 为准，
 * 否则设置页（宿主层）那份会把我们写进去的值盖回去。
 */
export function markOverrideKey(key) {
  const file = pondOverridePath()
  const cur = readJsonFile(file, {})
  if (cur[key] === undefined) {
    cur[key] = Date.now()
    writeJsonFile(file, cur)
    return true
  }
  return false
}

/** 写 config.json 的 autoRun（只改这一个键，其余原样保留）。 */
export function writePondAutoRun(on) {
  const cfg = readPondConfig()
  if (cfg.autoRun === (on === true)) return false
  cfg.autoRun = on === true
  writeJsonFile(pondConfigPath(), cfg)
  markOverrideKey('autoRun')
  return true
}

/**
 * 纯决策：今天该不该动鱼塘的自动运行。
 * 返回 action = 'park' | 'restore' | 'none'，why 只用于日志与界面。
 */
export function pondGateDecision(input) {
  const cfg = input && typeof input === 'object' ? input : {}
  const date = cfg.date instanceof Date ? cfg.date : new Date()
  const allowed = dayAllowed(cfg.days, date)
  const autoRun = cfg.autoRun === true
  const parked = cfg.parked === true
  if (allowed) {
    if (parked) return { action: 'restore', why: 'scheduled-day' }
    return { action: 'none', why: 'scheduled-day' }
  }
  if (autoRun && !parked) return { action: 'park', why: 'outside-day' }
  if (parked) return { action: 'none', why: 'already-parked' }
  return { action: 'none', why: autoRun ? 'outside-day' : 'already-off' }
}

/**
 * 执行决策：只在真需要改的时候写盘。
 * 返回 { ok, action, changed, autoRun, parked, error? } —— parked 是新状态，调用方负责记进自己的设置。
 */
export function applyPondGate(input) {
  const cfg = input && typeof input === 'object' ? input : {}
  const date = cfg.date instanceof Date ? cfg.date : new Date()
  const autoRun = pondAutoRun()
  const parked = cfg.parked === true
  const verdict = pondGateDecision({ days: cfg.days, autoRun: autoRun, parked: parked, date: date })
  try {
    if (verdict.action === 'park') {
      writePondAutoRun(false)
      return { ok: true, action: 'park', changed: true, autoRun: false, parked: true, why: verdict.why }
    }
    if (verdict.action === 'restore') {
      writePondAutoRun(true)
      return { ok: true, action: 'restore', changed: true, autoRun: true, parked: false, why: verdict.why }
    }
    return { ok: true, action: 'none', changed: false, autoRun: autoRun, parked: parked, why: verdict.why }
  } catch (error) {
    return { ok: false, action: verdict.action, changed: false, autoRun: autoRun, parked: parked, error: String((error && error.message) || error) }
  }
}

/** 给界面看的状态：鱼塘现在开没开、是不是我们关的、排班是哪几天。 */
export function pondGateStatus(pondSettings) {
  const pond = pondSettings && typeof pondSettings === 'object' ? pondSettings : {}
  const dir = pondDir()
  return {
    dir: dir,
    exists: existsSync(dir),
    autoRun: pondAutoRun(),
    gate: pond.gate === true,
    days: normalizeDays(pond.days),
    parked: pond.parked === true,
    parkedAt: Number(pond.parkedAt) || 0,
    lastError: typeof pond.lastError === 'string' ? pond.lastError : '',
  }
}
