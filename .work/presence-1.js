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

export const DEFAULT_ROUTINE = [
  { from: '07:00', to: '09:00', room: 'kitchen', activity: '吃早饭' },
  { from: '09:00', to: '12:00', room: 'study', activity: '看书' },
  { from: '12:00', to: '13:30', room: 'dining', activity: '吃午饭' },
  { from: '13:30', to: '18:00', room: 'study', activity: '做事' },
  { from: '18:00', to: '19:30', room: 'dining', activity: '吃晚饭' },
  { from: '19:30', to: '23:30', room: 'living', activity: '在客厅待着' },
  { from: '23:30', to: '07:00', room: 'guest', activity: '睡着' },
]

const roomIds = new Set(ROOMS.map(room => room.id))

export function roomById(id) {
  for (const room of ROOMS) {
    if (room.id === id) {
      return room
    }
  }
  return null
}

function isValidHhmm(value) {
  if (typeof value !== 'string' || value.length !== 5) {
    return false
  }
  if (value.charAt(2) !== ':') {
    return false
  }
  const hh = Number(value.slice(0, 2))
  const mm = Number(value.slice(3, 5))
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) {
    return false
  }
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
}

function hhmmToMinutes(value) {
  if (typeof value !== 'string' || value.length !== 5 || value.charAt(2) !== ':') {
    return -1
  }
  const hh = Number(value.slice(0, 2))
  const mm = Number(value.slice(3, 5))
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) {
    return -1
  }
  return hh * 60 + mm
}

function isValidRoutineItem(item) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return false
  }
  if (!isValidHhmm(item.from)) {
    return false
  }
  if (!isValidHhmm(item.to)) {
    return false
  }
  if (!roomIds.has(item.room)) {
    return false
  }
  if (typeof item.activity !== 'string' || item.activity.length === 0) {
    return false
  }
  return true
}

function cloneRoutineItems(items) {
  return items.map(item => ({
    from: item.from,
    to: item.to,
    room: item.room,
    activity: item.activity,
  }))
}

export function normalizeRoutine(input) {
  let items = null

  if (Array.isArray(input)) {
    items = input
  } else if (input !== null && typeof input === 'object') {
    if (Array.isArray(input.items)) {
      items = input.items
    } else if (Array.isArray(input.routine)) {
      items = input.routine
    }
  }

  if (!Array.isArray(items) || items.length === 0) {
    return cloneRoutineItems(DEFAULT_ROUTINE)
  }

  for (const item of items) {
    if (!isValidRoutineItem(item)) {
      return cloneRoutineItems(DEFAULT_ROUTINE)
    }
  }

  return cloneRoutineItems(items)
}

function parseIso(iso) {
  if (typeof iso !== 'string') {
    return null
  }
  const ts = new Date(iso).getTime()
  if (!Number.isFinite(ts)) {
    return null
  }
  return ts
}

export function emptyPresence(nowIso) {
  return {
    room: null,
    activity: '',
    since: nowIso,
    moving: null,
    lastPlannedAt: null,
  }
}

export function plannedAt(routine, nowIso) {
  if (!Array.isArray(routine)) {
    return null
  }

  const nowTs = parseIso(nowIso)
  if (nowTs === null) {
    return null
  }

  const nowDate = new Date(nowTs)
  const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()

  for (const item of routine) {
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

function addMinutesIso(iso, minutes) {
  const ts = parseIso(iso)
  if (ts === null) {
    return null
  }
  return new Date(ts + minutes * 60000).toISOString()
}

function copyState(state) {
  return {
    room: state.room,
    activity: state.activity,
    since: state.since,
    moving: state.moving === null ? null : {
      from: state.moving.from,
      to: state.moving.to,
      arriveAt: state.moving.arriveAt,
      activity: state.moving.activity,
    },
    lastPlannedAt: state.lastPlannedAt,
    lastSeenAt: state.lastSeenAt,
  }
}

export function reducePresence(state, event, nowIso, routine) {
  const next = copyState(state)

  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return next
  }

  const { type } = event

  if (type === 'move-to') {
    const { room, activity } = event
    if (!roomIds.has(room)) {
      return next
    }

    if (room === next.room && next.moving === null) {
      return {
        ...next,
        since: nowIso,
        activity: typeof activity === 'string' ? activity : next.activity,
      }
    }

    return {
      ...next,
      moving: {
        from: next.room,
        to: room,
        arriveAt: addMinutesIso(nowIso, MOVE_MINUTES),
        activity: typeof activity === 'string' ? activity : next.activity,
      },
    }
  }

  if (type === 'tick') {
    const nowTs = parseIso(nowIso)

    if (next.moving !== null) {
      const arriveTs = parseIso(next.moving.arriveAt)
      if (arriveTs !== null && nowTs !== null && nowTs >= arriveTs) {
        return {
          ...next,
          room: next.moving.to,
          activity: next.moving.activity,
          since: next.moving.arriveAt,
          moving: null,
        }
      }
      return next
    }

    const plan = plannedAt(routine, nowIso)
    next.lastPlannedAt = nowIso

    if (plan === null) {
      return next
    }

    if (plan.room !== next.room) {
      return {
        ...next,
        moving: {
          from: next.room,
          to: plan.room,
          arriveAt: addMinutesIso(nowIso, MOVE_MINUTES),
          activity: plan.activity,
        },
        lastPlannedAt: nowIso,
      }
    }

    return next
  }

  if (type === 'user-message') {
    return {
      ...next,
      lastSeenAt: nowIso,
    }
  }

  return next
}

export function describePresence(state, nowIso) {
  const room = roomById(state.room)
  if (room === null) {
    return '她还不知道自己该在哪儿'
  }

  if (state.moving !== null) {
    const target = roomById(state.moving.to)
    const targetName = target === null ? '未知房间' : target.name
    return `她在去${targetName}的路上`
  }

  if (state.activity) {
    return `她在${room.name}，${state.activity}`
  }

  return `她在${room.name}`
}
