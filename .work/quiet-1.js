export const QUIET_STATES = ['awake', 'drowsy', 'quiet']
export const DEFAULT_QUIET = { from: '23:30', to: '07:00', drowsyIdleMin: 25, quietIdleMin: 55 }

export function minutesOfDay(hhmm) {
  if (typeof hhmm !== 'string') return null
  const m = hhmm.match(/^([01]\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function inWindow(nowMin, fromMin, toMin) {
  if (fromMin === null || toMin === null) return false
  if (fromMin === toMin) return false
  if (fromMin < toMin) return nowMin >= fromMin && nowMin < toMin
  return nowMin >= fromMin || nowMin < toMin
}

export function normalizeQuiet(input) {
  const def = DEFAULT_QUIET
  if (!input || typeof input !== 'object') return { ...def }
  const from = minutesOfDay(input.from) ?? minutesOfDay(def.from)
  const to = minutesOfDay(input.to) ?? minutesOfDay(def.to)
  const drowsyIdleMin = Number.isFinite(input.drowsyIdleMin) ? Math.max(0, Math.floor(input.drowsyIdleMin)) : def.drowsyIdleMin
  const quietIdleMin = Number.isFinite(input.quietIdleMin) ? Math.max(0, Math.floor(input.quietIdleMin)) : def.quietIdleMin
  return { from, to, drowsyIdleMin, quietIdleMin }
}

function toMs(iso) {
  if (typeof iso !== 'string') return NaN
  const t = Date.parse(iso)
  return Number.isNaN(t) ? NaN : t
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
  const nowMs = toMs(nowIso)
  const base = { ...state }
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
      const inWin = inWindow(
        new Date(nowIso).getHours() * 60 + new Date(nowIso).getMinutes(),
        cfg.from,
        cfg.to
      )
      const idle = idleMinutes(base.lastUserAt, nowMs)

      if (base.state === 'awake') {
        if (inWin && idle >= cfg.drowsyIdleMin) {
          return { ...base, state: 'drowsy', since: nowIso }
        }
        return base
      }
      if (base.state === 'drowsy') {
        if (inWin) {
          if (idle >= cfg.quietIdleMin) {
            return { ...base, state: 'quiet', since: nowIso, quietSince: nowIso }
          }
          return base
        }
        return { ...base, state: 'awake', since: nowIso }
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
      const until = new Date(nowMs + mins * 60000).toISOString()
      return { ...base, overrideUntil: until }
    }
    default:
      return base
  }
}

export function canSpeak(state, nowIso, opts = {}) {
  const nowMs = toMs(nowIso)
  if (state.overrideUntil) {
    const untilMs = toMs(state.overrideUntil)
    if (!Number.isNaN(untilMs) && nowMs < untilMs) return { ok: true, reason: 'override' }
  }
  if (state.state === 'quiet') return { ok: false, reason: 'quiet' }
  if (state.state === 'drowsy') {
    if (opts.urgent === true) return { ok: true, reason: 'drowsy-urgent' }
    return { ok: false, reason: 'drowsy' }
  }
  return { ok: true, reason: 'awake' }
}

export function noteSuppressed(state, item, nowIso) {
  if (!item || typeof item !== 'object') return state
  const entry = { kind: item.kind, text: item.text, at: nowIso }
  const suppressed = [...state.suppressed, entry]
  if (suppressed.length > 50) suppressed.shift()
  return { ...state, suppressed }
}
