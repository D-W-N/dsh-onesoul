export const QUIET_STATES = ['awake', 'drowsy', 'quiet']
export const DEFAULT_QUIET = { from: '23:30', to: '07:00', drowsyIdleMin: 25, quietIdleMin: 55 }

export function minutesOfDay(hhmm) {
  if (typeof hhmm !== 'string') return null
  const m = hhmm.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function inWindow(nowMin, fromMin, toMin) {
  if (!Number.isFinite(nowMin) || !Number.isFinite(fromMin) || !Number.isFinite(toMin)) return false
  if (fromMin === toMin) return false
  if (fromMin < toMin) return nowMin >= fromMin && nowMin < toMin
  return nowMin >= fromMin || nowMin < toMin
}

export function normalizeQuiet(input) {
  const def = DEFAULT_QUIET
  if (!input || typeof input !== 'object') return { ...def }
  const from = minutesOfDay(input.from) === null ? def.from : input.from
  const to = minutesOfDay(input.to) === null ? def.to : input.to
  // 非正数/非数字一律回落默认值（0 或负的空闲门槛没有意义）
  const positive = (v, fallback) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback)
  const drowsyIdleMin = positive(input.drowsyIdleMin, def.drowsyIdleMin)
  const quietIdleMin = positive(input.quietIdleMin, Math.max(drowsyIdleMin + 1, def.quietIdleMin))
  return { from, to, drowsyIdleMin, quietIdleMin }
}

function toMs(iso) {
  if (typeof iso !== 'string') return NaN
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? NaN : t
}

function minutesFromIso(iso) {
  const ms = toMs(iso)
  if (Number.isNaN(ms)) return null
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

function idleMinutes(lastUserAt, nowMs) {
  const last = toMs(lastUserAt)
  if (Number.isNaN(last)) return Infinity
  return (nowMs - last) / 60000
}

export function emptyQuiet(nowIso) {
  return {
    state: 'awake',
    since: nowIso,
    lastUserAt: null,
    quietSince: null,
    suppressed: [],
    overrideUntil: null
  }
}

export function reduceQuiet(state, event, nowIso, cfg) {
  const base = state && typeof state === 'object' ? { ...state } : emptyQuiet(nowIso)
  if (!event || typeof event !== 'object') return base

  switch (event.type) {
    case 'goodnight': {
      return {
        ...base,
        state: 'quiet',
        since: nowIso,
        quietSince: nowIso,
        lastUserAt: nowIso
      }
    }
    case 'goodmorning': {
      return {
        ...base,
        state: 'awake',
        since: nowIso,
        quietSince: null
      }
    }
    case 'user-message': {
      const nextState = base.state === 'quiet' || base.state === 'drowsy' ? 'awake' : base.state
      return {
        ...base,
        state: nextState,
        since: nextState !== base.state ? nowIso : base.since,
        lastUserAt: nowIso
      }
    }
    case 'tick': {
      const nowMs = toMs(nowIso)
      if (Number.isNaN(nowMs)) return base
      const conf = normalizeQuiet(cfg)
      const fromMin = minutesOfDay(conf.from)
      const toMin = minutesOfDay(conf.to)
      const nowMin = minutesFromIso(nowIso)
      const inWin = nowMin !== null && inWindow(nowMin, fromMin, toMin)
      const idle = idleMinutes(base.lastUserAt, nowMs)

      if (base.state === 'awake') {
        if (inWin && idle >= conf.drowsyIdleMin) {
          return { ...base, state: 'drowsy', since: nowIso }
        }
        return base
      }
      if (base.state === 'drowsy') {
        if (!inWin) {
          return { ...base, state: 'awake', since: nowIso }
        }
        if (idle >= conf.quietIdleMin) {
          return { ...base, state: 'quiet', since: nowIso, quietSince: nowIso }
        }
        return base
      }
      if (base.state === 'quiet') {
        if (!inWin) {
          return { ...base, state: 'awake', since: nowIso, quietSince: null }
        }
        return base
      }
      return base
    }
    case 'override': {
      const mins = Number.isFinite(event.minutes) ? Math.max(0, Math.floor(event.minutes)) : 0
      const nowMs = toMs(nowIso)
      if (Number.isNaN(nowMs)) return base
      const until = new Date(nowMs + mins * 60000).toISOString()
      return { ...base, overrideUntil: until }
    }
    default:
      return base
  }
}

export function canSpeak(state, nowIso, opts = {}) {
  const st = state && typeof state === 'object' ? state : {}
  const nowMs = toMs(nowIso)
  if (st.overrideUntil) {
    const untilMs = toMs(st.overrideUntil)
    if (!Number.isNaN(untilMs) && nowMs < untilMs) return { ok: true, reason: 'override' }
  }
  if (st.state === 'quiet') return { ok: false, reason: 'quiet' }
  if (st.state === 'drowsy') {
    if (opts && opts.urgent === true) return { ok: true, reason: 'drowsy-urgent' }
    return { ok: false, reason: 'drowsy' }
  }
  return { ok: true, reason: 'awake' }
}

export function noteSuppressed(state, item, nowIso) {
  const base = state && typeof state === 'object' ? { ...state } : emptyQuiet(nowIso)
  if (!item || typeof item !== 'object') return base
  const entry = { kind: item.kind, text: item.text, at: nowIso }
  const prev = Array.isArray(base.suppressed) ? base.suppressed : []
  const suppressed = [...prev, entry].slice(-50)
  return { ...base, suppressed }
}
