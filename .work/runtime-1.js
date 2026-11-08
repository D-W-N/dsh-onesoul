import { emptyQuiet, normalizeQuiet, reduceQuiet, canSpeak, noteSuppressed, minutesOfDay } from './quiet.js'
import { emptyPresence, normalizeRoutine, reducePresence, describePresence, DEFAULT_ROUTINE } from './presence.js'
import { emptyMood, normalizeMood, reduceMood, describeMood, suggestMusic, valenceLabel } from './mood.js'
import { animaDir } from './store.js'

export function runtimePath() {
  return animaDir() + '/runtime.json'
}

export function emptyRuntime(nowIso) {
  return {
    quiet: emptyQuiet(),
    presence: emptyPresence(),
    mood: emptyMood(),
    routine: JSON.parse(JSON.stringify(DEFAULT_ROUTINE)),
    quietCfg: normalizeQuiet(),
    updatedAt: nowIso
  }
}

export function normalizeRuntime(raw, nowIso) {
  if (!raw || typeof raw !== 'object') {
    return emptyRuntime(nowIso)
  }

  const quiet = raw.quiet && typeof raw.quiet === 'object'
    ? { ...emptyQuiet(), ...raw.quiet }
    : emptyQuiet()

  const presence = raw.presence && typeof raw.presence === 'object'
    ? { ...emptyPresence(), ...raw.presence }
    : emptyPresence()

  const mood = raw.mood && typeof raw.mood === 'object'
    ? { ...emptyMood(), ...raw.mood }
    : emptyMood()

  const routine = normalizeRoutine(raw.routine)
  const quietCfg = normalizeQuiet(raw.quietCfg ?? raw.quiet)

  return {
    quiet,
    presence,
    mood,
    routine,
    quietCfg,
    updatedAt: raw.updatedAt || nowIso
  }
}

export function applyRuntimeEvent(runtime, event, nowIso) {
  const type = event?.type
  let next = { ...runtime }

  switch (type) {
    case 'message':
      next.quiet = reduceQuiet(runtime.quiet, { type: 'user-message' }, nowIso, runtime.quietCfg)
      next.presence = reducePresence(runtime.presence, { type: 'user-message' }, nowIso, runtime.routine)
      next.mood = reduceMood(runtime.mood, event, nowIso)
      break
    case 'goodnight':
    case 'goodmorning':
      next.quiet = reduceQuiet(runtime.quiet, { type }, nowIso, runtime.quietCfg)
      next.presence = reducePresence(runtime.presence, { type: 'tick' }, nowIso, runtime.routine)
      next.mood = reduceMood(runtime.mood, event, nowIso)
      break
    case 'tick':
      next.quiet = reduceQuiet(runtime.quiet, { type: 'tick' }, nowIso, runtime.quietCfg)
      next.presence = reducePresence(runtime.presence, { type: 'tick' }, nowIso, runtime.routine)
      next.mood = reduceMood(runtime.mood, event, nowIso)
      break
    case 'move-to':
      next.presence = reducePresence(runtime.presence, event, nowIso, runtime.routine)
      break
    case 'override':
      next.quiet = reduceQuiet(runtime.quiet, event, nowIso, runtime.quietCfg)
      break
    case 'suppressed':
      next.quiet = noteSuppressed(runtime.quiet, { kind: event.kind, text: event.text }, nowIso)
      break
    default:
      break
  }

  next.updatedAt = nowIso
  return next
}

export function summarizeRuntime(runtime, nowIso) {
  const lines = ['## 此刻的状态']

  let presenceText, moodText
  try {
    presenceText = describePresence(runtime.presence, nowIso)
  } catch {
    presenceText = '不知道'
  }
  try {
    moodText = describeMood(runtime.mood, nowIso)
  } catch {
    moodText = '不知道'
  }

  lines.push('- 位置：' + presenceText)
  lines.push('- 心情：' + moodText)

  let gateText
  try {
    const speakable = canSpeak(runtime.quiet)
    const state = runtime.quiet?.state
    if (state === 'quiet') {
      const since = runtime.quiet?.quietSince
      const time = since ? formatLocalTime(since) : '--'
      const count = runtime.quiet?.suppressed?.length || 0
      gateText = `静默中（从 ${time} 起，压着 ${count} 条待说）`
    } else if (state === 'drowsy') {
      gateText = '半睡了，只有急事才开口'
    } else {
      gateText = '醒着，可以说话'
    }
  } catch {
    gateText = '不知道'
  }
  lines.push('- 说话门：' + gateText)

  try {
    if (runtime.mood?.valence < -0.15) {
      lines.push('- 提醒：她现在不太好，先接住情绪，别急着讲道理')
    }
  } catch {}

  try {
    if (runtime.quiet?.state === 'quiet' && runtime.quiet?.suppressed?.length > 0) {
      lines.push(`- 攒着的话：还有 ${runtime.quiet.suppressed.length} 条等她自己开口`)
    }
  } catch {}

  return lines.join('\n')
}

function formatLocalTime(iso) {
  if (!iso) return '--'
  const d = new Date(iso)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}
