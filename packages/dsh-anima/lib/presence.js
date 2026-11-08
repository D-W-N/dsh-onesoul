export const ROOMS = [
  { id: 'living', name: '客厅' },
  { id: 'dining', name: '餐厅' },
  { id: 'balcony', name: '阳台' },
  { id: 'guest', name: '次卧' },
  { id: 'kitchen', name: '厨房·餐室' },
  { id: 'entry', name: '玄关' },
  { id: 'study', name: '书房' },
]

export const MOVE_MINUTES = 3
// 人工修正：被主人（或她自己）手动指派房间后，日程要在这么多分钟内让位，
// 否则「刚被派去阳台，三分钟后自己走回书房」这种荒谬动作会出现在位置卡上。
export const HOLD_MINUTES = 30

export const DEFAULT_ROUTINE = [
  { from: '07:00', to: '09:00', room: 'kitchen', activity: '吃早饭' },
  { from: '09:00', to: '12:00', room: 'study', activity: '看书' },
  { from: '12:00', to: '13:30', room: 'dining', activity: '吃午饭' },
  { from: '13:30', to: '18:00', room: 'study', activity: '做事' },
  { from: '18:00', to: '19:30', room: 'dining', activity: '吃晚饭' },
  { from: '19:30', to: '23:30', room: 'living', activity: '在客厅待着' },
  { from: '23:30', to: '07:00', room: 'guest', activity: '睡着' },
]

const ROOM_IDS = new Set(ROOMS.map(room => room.id))

export function roomById(id) {
  for (const room of ROOMS) {
    if (room.id === id) {
      return room
    }
  }
  return null
}

function isHhmm(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    return false
  }
  const hh = Number(value.slice(0, 2))
  const mm = Number(value.slice(3, 5))
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
}

function hhmmToMinutes(value) {
  if (!isHhmm(value)) {
    return -1
  }
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
}

function isValidRoutineItem(item) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return false
  }
  if (!isHhmm(item.from) || !isHhmm(item.to)) {
    return false
  }
  if (!ROOM_IDS.has(item.room)) {
    return false
  }
  if (typeof item.activity !== 'string' || item.activity.length === 0) {
    return false
  }
  return true
}

function cloneRoutine(items) {
  return items.map(item => ({
    from: item.from,
    to: item.to,
    room: item.room,
    activity: item.activity,
  }))
}

function extractRoutineItems(input) {
  if (Array.isArray(input)) {
    return input
  }
  if (input !== null && typeof input === 'object') {
    if (Array.isArray(input.items)) {
      return input.items
    }
    if (Array.isArray(input.routine)) {
      return input.routine
    }
  }
  return null
}

export function normalizeRoutine(input) {
  const items = extractRoutineItems(input)
  if (items === null || items.length === 0) {
    return cloneRoutine(DEFAULT_ROUTINE)
  }
  for (const item of items) {
    if (!isValidRoutineItem(item)) {
      return cloneRoutine(DEFAULT_ROUTINE)
    }
  }
  return cloneRoutine(items)
}

function timestampOf(value) {
  if (typeof value === 'string') {
    const ts = new Date(value).getTime()
    return Number.isFinite(ts) ? ts : null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (value instanceof Date) {
    const ts = value.getTime()
    return Number.isFinite(ts) ? ts : null
  }
  return null
}

function isoOf(value) {
  if (typeof value === 'string') {
    return timestampOf(value) === null ? null : value
  }
  const ts = timestampOf(value)
  return ts === null ? null : new Date(ts).toISOString()
}

function addMinutesIso(value, minutes) {
  const ts = timestampOf(value)
  if (ts === null) {
    return null
  }
  return new Date(ts + minutes * 60000).toISOString()
}

function isMoving(state) {
  return state.moving !== null && state.moving !== undefined && typeof state.moving === 'object'
}

function copyState(state) {
  if (state === null || typeof state !== 'object') {
    return {
      room: null,
      activity: '',
      since: null,
      moving: null,
      lastPlannedAt: null,
    }
  }
  const next = { ...state }
  if (state.moving !== null && state.moving !== undefined && typeof state.moving === 'object') {
    next.moving = { ...state.moving }
  }
  return next
}

export function emptyPresence(nowIso) {
  return {
    room: null,
    activity: '',
    since: isoOf(nowIso),
    moving: null,
    lastPlannedAt: null,
    holdUntil: null,
  }
}

export function plannedAt(routine, nowIso) {
  const items = extractRoutineItems(routine)
  if (items === null) {
    return null
  }
  const ts = timestampOf(nowIso)
  if (ts === null) {
    return null
  }
  const date = new Date(ts)
  const nowMinutes = date.getHours() * 60 + date.getMinutes()

  for (const item of items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }
    if (!ROOM_IDS.has(item.room)) {
      continue
    }
    if (typeof item.activity !== 'string' || item.activity.length === 0) {
      continue
    }
    const fromMinutes = hhmmToMinutes(item.from)
    const toMinutes = hhmmToMinutes(item.to)
    if (fromMinutes < 0 || toMinutes < 0) {
      continue
    }

    let matched = false
    if (fromMinutes < toMinutes) {
      matched = nowMinutes >= fromMinutes && nowMinutes < toMinutes
    } else if (fromMinutes > toMinutes) {
      matched = nowMinutes >= fromMinutes || nowMinutes < toMinutes
    }

    if (matched) {
      return { room: item.room, activity: item.activity }
    }
  }

  return null
}

export function reducePresence(state, event, nowIso, routine) {
  const next = copyState(state)

  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return next
  }

  const now = isoOf(nowIso)
  const { type } = event

  if (type === 'move-to') {
    const { room } = event
    if (!ROOM_IDS.has(room)) {
      return next
    }

    const hasActivity = typeof event.activity === 'string'
    const sameRoomActivity = hasActivity ? event.activity : next.activity

    // 人工修正：还没落过脚（room 为 null）时没有「从哪儿走过来」这件事，
    // 直接落地；否则下去会造出一段 from=null 的移动，位置卡永远显示在路上。
    if (next.room === null && !isMoving(next)) {
      const landed = {
        ...next,
        room,
        activity: hasActivity ? event.activity : next.activity,
        moving: null,
      }
      if (now !== null) {
        landed.since = now
        landed.holdUntil = addMinutesIso(nowIso, HOLD_MINUTES)
      }
      return landed
    }

    if (room === next.room && !isMoving(next)) {
      const updated = {
        ...next,
        activity: sameRoomActivity === undefined ? '' : sameRoomActivity,
      }
      if (now !== null) {
        updated.since = now
        updated.holdUntil = addMinutesIso(nowIso, HOLD_MINUTES)
      }
      return updated
    }

    const movingActivity = typeof event.activity === 'string' && event.activity
      ? event.activity
      : next.activity

    return {
      ...next,
      holdUntil: addMinutesIso(nowIso, HOLD_MINUTES),
      moving: {
        from: next.room === undefined ? null : next.room,
        to: room,
        arriveAt: addMinutesIso(nowIso, MOVE_MINUTES),
        activity: movingActivity === undefined ? '' : movingActivity,
      },
    }
  }

  if (type === 'tick') {
    // 人工修正：落地与「按日程出发」必须在同一次 tick 里接续判断，
    // 否则她会在错误房间里多待一整个 tick（位置卡上看起来像卡住）。
    let cur = next
    if (isMoving(cur)) {
      const arriveTs = timestampOf(cur.moving.arriveAt)
      const nowTs = timestampOf(nowIso)
      if (arriveTs !== null && nowTs !== null && nowTs >= arriveTs) {
        cur = {
          ...cur,
          room: cur.moving.to,
          activity: cur.moving.activity === undefined ? '' : cur.moving.activity,
          since: cur.moving.arriveAt,
          moving: null,
        }
      } else {
        return cur
      }
    }

    const updated = now !== null ? { ...cur, lastPlannedAt: now } : cur
    const holdTs = timestampOf(updated.holdUntil)
    const nowTs2 = timestampOf(nowIso)
    if (holdTs !== null && nowTs2 !== null && nowTs2 < holdTs) {
      return updated
    }

    const plan = plannedAt(routine, nowIso)

    if (plan === null) {
      return updated
    }

    if (plan.room !== updated.room) {
      return {
        ...updated,
        moving: {
          from: updated.room === undefined ? null : updated.room,
          to: plan.room,
          arriveAt: addMinutesIso(nowIso, MOVE_MINUTES),
          activity: plan.activity,
        },
      }
    }

    return updated
  }

  if (type === 'user-message') {
    if (now === null) {
      return next
    }
    return {
      ...next,
      lastSeenAt: now,
    }
  }

  return next
}

export function describePresence(state, nowIso) {
  if (state === null || typeof state !== 'object') {
    return '她还不知道自己该在哪儿'
  }

  if (isMoving(state)) {
    const target = roomById(state.moving.to)
    if (target === null) {
      return '她还不知道自己该在哪儿'
    }
    return `她在去${target.name}的路上`
  }

  const room = roomById(state.room)
  if (room === null) {
    return '她还不知道自己该在哪儿'
  }

  if (state.activity) {
    return `她在${room.name}，${state.activity}`
  }

  return `她在${room.name}`
}
