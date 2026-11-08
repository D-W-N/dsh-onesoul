/**
 * 在场状态验收测试（协调者独立编写）。约定：日程与墙钟一律按**本地时间**。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from '../packages/dsh-anima/lib/presence.js'

const local = (h, m, day = 9) => new Date(2026, 10, day, h, m, 0, 0).toISOString()

test('ROOMS：七间房，id 唯一，都有中文名', () => {
  assert.equal(P.ROOMS.length, 7)
  const ids = P.ROOMS.map((r) => r.id)
  assert.equal(new Set(ids).size, 7)
  for (const r of P.ROOMS) assert.ok(r.id && r.name)
  assert.deepEqual(ids, ['living', 'dining', 'balcony', 'guest', 'kitchen', 'entry', 'study'])
})

test('roomById：命中与未命中', () => {
  assert.equal(P.roomById('study').name, '书房')
  assert.equal(P.roomById('nope'), null)
  assert.equal(P.roomById(null), null)
})

test('normalizeRoutine：三种形态都能吃，脏输入整份回落', () => {
  const base = P.normalizeRoutine(undefined)
  assert.ok(Array.isArray(base) && base.length > 0)
  assert.equal(base, P.DEFAULT_ROUTINE ? base : base.slice()) // 只要求是数组

  const a = P.normalizeRoutine(P.DEFAULT_ROUTINE.map((x) => ({ ...x, activity: x.activity + '!' })))
  assert.ok(a[0].activity.endsWith('!'))

  const b = P.normalizeRoutine({ items: P.DEFAULT_ROUTINE })
  assert.equal(b.length, P.DEFAULT_ROUTINE.length)
  const c = P.normalizeRoutine({ routine: P.DEFAULT_ROUTINE })
  assert.equal(c.length, P.DEFAULT_ROUTINE.length)

  const badRoom = P.normalizeRoutine([{ from: '07:00', to: '08:00', room: 'moon', activity: '飘' }])
  assert.equal(badRoom.length, P.DEFAULT_ROUTINE.length, '非法房间应整份回落')
  assert.deepEqual(P.normalizeRoutine([]), P.normalizeRoutine(undefined))
})

test('plannedAt：命中、跨零点、空档', () => {
  const r = P.normalizeRoutine(undefined)
  assert.deepEqual(P.plannedAt(r, local(10, 0)), { room: 'study', activity: '看书' })
  assert.equal(P.plannedAt(r, local(2, 0)).room, 'guest')
  assert.equal(P.plannedAt(r, local(12, 30)).room, 'dining')

  const gap = P.normalizeRoutine([{ from: '09:00', to: '10:00', room: 'study', activity: '看书' }])
  assert.equal(P.plannedAt(gap, local(11, 0)), null)
})

test('emptyPresence：还不知道自己该在哪儿', () => {
  const s = P.emptyPresence(local(10, 0))
  assert.equal(s.room, null)
  assert.equal(s.moving, null)
  assert.ok(s.since)
})

test('move-to：同房间不移动，异房间进 moving 且位置暂不变', () => {
  const r = P.normalizeRoutine(undefined)
  let s = P.emptyPresence(local(10, 0))
  s = P.reducePresence(s, { type: 'move-to', room: 'study', activity: '看书' }, local(10, 0), r)
  assert.equal(s.room, 'study')
  assert.equal(s.moving, null)

  const before = s
  s = P.reducePresence(s, { type: 'move-to', room: 'study', activity: '写字' }, local(10, 1), r)
  assert.equal(s.activity, '写字')
  assert.equal(before.activity, '看书', '不得修改入参')
  assert.equal(s.moving, null)

  s = P.reducePresence(s, { type: 'move-to', room: 'kitchen' }, local(10, 2), r)
  assert.ok(s.moving)
  assert.equal(s.moving.from, 'study')
  assert.equal(s.moving.to, 'kitchen')
  assert.equal(s.room, 'study', '路上时还不在目标房间')
  const gapMin = (new Date(s.moving.arriveAt).getTime() - new Date(local(10, 2)).getTime()) / 60000
  assert.equal(gapMin, P.MOVE_MINUTES)

  const bad = P.reducePresence(s, { type: 'move-to', room: 'moon' }, local(10, 3), r)
  assert.equal(bad.room, s.room)
  assert.deepEqual(bad.moving, s.moving)
})

test('tick：路上到点落地；按日程自动出发', () => {
  const r = P.normalizeRoutine(undefined)
  let s = P.reducePresence(P.emptyPresence(local(10, 0)), { type: 'move-to', room: 'study' }, local(10, 0), r)
  s = P.reducePresence(s, { type: 'move-to', room: 'balcony' }, local(10, 5), r)
  assert.ok(s.moving)

  const tooEarly = P.reducePresence(s, { type: 'tick' }, local(10, 6), r)
  assert.equal(tooEarly.room, 'study')
  assert.ok(tooEarly.moving, '还没到点')

  const arrived = P.reducePresence(s, { type: 'tick' }, local(10, 9), r)
  assert.equal(arrived.room, 'balcony')
  assert.equal(arrived.moving, null)

  // 12:00 日程换成餐厅，人在书房 → 自动出发
  let noon = P.reducePresence(arrived, { type: 'move-to', room: 'study', activity: '做事' }, local(11, 0), r)
  noon = P.reducePresence(noon, { type: 'tick' }, local(12, 0), r)
  assert.ok(noon.moving, '日程换房间时应自动出发')
  assert.equal(noon.moving.to, 'dining')
  const noon2 = P.reducePresence(noon, { type: 'tick' }, local(12, 10), r)
  assert.equal(noon2.room, 'dining')
})

test('tick：日程空档时什么都不做，user-message 不改位置', () => {
  const gap = P.normalizeRoutine([{ from: '09:00', to: '10:00', room: 'study', activity: '看书' }])
  let s = P.reducePresence(P.emptyPresence(local(11, 0)), { type: 'move-to', room: 'living' }, local(11, 0), gap)
  const before = s
  s = P.reducePresence(s, { type: 'tick' }, local(11, 10), gap)
  assert.equal(s.room, 'living')
  assert.equal(s.moving, null)

  const spoken = P.reducePresence(s, { type: 'user-message' }, local(11, 20), gap)
  assert.equal(spoken.room, 'living')
  assert.equal(before.room, 'living')
  assert.ok(spoken.lastSeenAt)
})

test('describePresence：四种说法都对', () => {
  const r = P.normalizeRoutine(undefined)
  assert.equal(P.describePresence(P.emptyPresence(local(10, 0)), local(10, 0)), '她还不知道自己该在哪儿')

  let s = P.reducePresence(P.emptyPresence(local(10, 0)), { type: 'move-to', room: 'study', activity: '看书' }, local(10, 0), r)
  assert.equal(P.describePresence(s, local(10, 1)), '她在书房，看书')

  const noAct = { ...s, activity: '' }
  assert.equal(P.describePresence(noAct, local(10, 1)), '她在书房')

  s = P.reducePresence(s, { type: 'move-to', room: 'balcony' }, local(10, 2), r)
  assert.equal(P.describePresence(s, local(10, 3)), '她在去阳台的路上')

  assert.equal(P.describePresence({ ...s, moving: null, room: 'moon' }, local(10, 3)), '她还不知道自己该在哪儿')
})

test('未知事件与坏时间：不抛异常、状态不歪', () => {
  const r = P.normalizeRoutine(undefined)
  const s = P.reducePresence(P.emptyPresence(local(10, 0)), { type: 'move-to', room: 'study' }, local(10, 0), r)
  const u = P.reducePresence(s, { type: 'nonsense' }, local(10, 1), r)
  assert.equal(u.room, s.room)
  assert.equal(P.describePresence(s, 'not-a-date').includes('书房'), true)
})

test('手动指派后有让位期：日程 30 分钟内不抢人，过期才接管', () => {
  const r = P.normalizeRoutine(undefined)
  assert.equal(P.HOLD_MINUTES, 30)
  let s = P.reducePresence(P.emptyPresence(local(10, 0)), { type: 'move-to', room: 'study' }, local(10, 0), r)
  s = P.reducePresence(s, { type: 'move-to', room: 'balcony' }, local(10, 5), r)
  const arrived = P.reducePresence(s, { type: 'tick' }, local(10, 9), r)
  assert.equal(arrived.room, 'balcony')
  assert.equal(arrived.moving, null)

  const holding = P.reducePresence(arrived, { type: 'tick' }, local(10, 30), r)
  assert.equal(holding.room, 'balcony', '让位期内日程不得抢人')
  assert.equal(holding.moving, null)

  const expired = P.reducePresence(arrived, { type: 'tick' }, local(10, 40), r)
  assert.ok(expired.moving, '让位期过了日程应接管')
  assert.equal(expired.moving.to, 'study')
})
