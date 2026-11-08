/**
 * 静默门验收测试（由协调者独立编写，不依赖实现方的自测）。
 * 约定：时间窗口按**本地墙钟**判断（主人的作息是本地的）；用 new Date(y,m,d,h,min) 构造以求与机器时区无关。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Q from '../packages/dsh-anima/lib/quiet.js'

const local = (h, m, day = 9) => new Date(2026, 10, day, h, m, 0, 0).toISOString()

test('minutesOfDay：合法与非法输入', () => {
  assert.equal(Q.minutesOfDay('23:30'), 1410)
  assert.equal(Q.minutesOfDay('00:00'), 0)
  assert.equal(Q.minutesOfDay('07:00'), 420)
  assert.equal(Q.minutesOfDay('24:00'), null)
  assert.equal(Q.minutesOfDay('7:00'), null)
  assert.equal(Q.minutesOfDay('ab'), null)
  assert.equal(Q.minutesOfDay(null), null)
  assert.equal(Q.minutesOfDay(undefined), null)
})

test('inWindow：跨零点与空窗口', () => {
  assert.equal(Q.inWindow(1410, 1410, 420), true) // 23:30 起点含
  assert.equal(Q.inWindow(0, 1410, 420), true) // 00:00 在窗口内
  assert.equal(Q.inWindow(419, 1410, 420), true) // 06:59
  assert.equal(Q.inWindow(420, 1410, 420), false) // 07:00 终点不含
  assert.equal(Q.inWindow(720, 1410, 420), false) // 12:00
  assert.equal(Q.inWindow(600, 540, 660), true) // 普通区间 09:00-11:00
  assert.equal(Q.inWindow(300, 300, 300), false) // 空窗口
})

test('normalizeQuiet：脏输入回落默认，且不抛异常', () => {
  const a = Q.normalizeQuiet(undefined)
  assert.equal(a.from, '23:30')
  assert.equal(a.to, '07:00')
  assert.ok(a.drowsyIdleMin > 0 && a.quietIdleMin > a.drowsyIdleMin)
  const b = Q.normalizeQuiet({ from: '99:99', to: '7:00', drowsyIdleMin: -3 })
  assert.equal(b.from, '23:30')
  assert.equal(b.to, '07:00')
  assert.ok(b.drowsyIdleMin > 0)
  const c = Q.normalizeQuiet({ from: '01:00', to: '01:00' })
  const nowMin = 60
  assert.equal(Q.inWindow(nowMin, Q.minutesOfDay(c.from), Q.minutesOfDay(c.to)), false)
})

test('emptyQuiet：初始为醒着，无待说清单', () => {
  const s = Q.emptyQuiet(local(20, 0))
  assert.equal(s.state, 'awake')
  assert.deepEqual(s.suppressed, [])
  assert.ok(s.since)
})

test('goodnight / goodmorning / user-message 的状态迁移', () => {
  const cfg = Q.normalizeQuiet()
  let s = Q.emptyQuiet(local(23, 40))
  s = Q.reduceQuiet(s, { type: 'goodnight' }, local(23, 40), cfg)
  assert.equal(s.state, 'quiet')
  assert.ok(s.quietSince)
  assert.deepEqual(Q.canSpeak(s, local(23, 41)), { ok: false, reason: 'quiet' })

  s = Q.reduceQuiet(s, { type: 'goodmorning' }, local(7, 5, 10), cfg)
  assert.equal(s.state, 'awake')

  // 静默中主人自己开口 → 立刻醒
  let t = Q.reduceQuiet(Q.emptyQuiet(local(2, 0)), { type: 'goodnight' }, local(2, 0), cfg)
  t = Q.reduceQuiet(t, { type: 'user-message' }, local(2, 30), cfg)
  assert.equal(t.state, 'awake')
})

test('goodmorning 不清空待说清单', () => {
  const cfg = Q.normalizeQuiet()
  let s = Q.reduceQuiet(Q.emptyQuiet(local(23, 40)), { type: 'goodnight' }, local(23, 40), cfg)
  s = Q.noteSuppressed(s, { kind: 'speak', text: '晚安' }, local(23, 45))
  s = Q.noteSuppressed(s, { kind: 'message', text: '想你了' }, local(23, 50))
  assert.equal(s.suppressed.length, 2)
  s = Q.reduceQuiet(s, { type: 'goodmorning' }, local(7, 5, 10), cfg)
  assert.equal(s.state, 'awake')
  assert.equal(s.suppressed.length, 2)
})

test('noteSuppressed：带时间、纯函数、上限 50 条丢最旧', () => {
  const base = Q.emptyQuiet(local(23, 40))
  const s1 = Q.noteSuppressed(base, { kind: 'speak', text: 'a' }, local(23, 41))
  assert.equal(base.suppressed.length, 0, '不得修改入参')
  assert.equal(s1.suppressed.length, 1)
  assert.equal(s1.suppressed[0].text, 'a')
  assert.ok(s1.suppressed[0].at)

  let s = Q.emptyQuiet(local(23, 40))
  for (let i = 0; i < 60; i += 1) {
    s = Q.noteSuppressed(s, { kind: 'speak', text: `t${i}` }, local(23, 40))
  }
  assert.equal(s.suppressed.length, 50)
  assert.equal(s.suppressed[0].text, 't10')
  assert.equal(s.suppressed[49].text, 't59')
})

test('tick：窗口内空闲到点才睡，窗口外回醒', () => {
  const cfg = Q.normalizeQuiet()
  const t0 = local(23, 40)
  let s = Q.emptyQuiet(t0)
  s = Q.reduceQuiet(s, { type: 'user-message' }, t0, cfg)
  s = Q.reduceQuiet(s, { type: 'tick' }, local(23, 50), cfg)
  assert.equal(s.state, 'awake', '空闲不足不走')

  s = Q.reduceQuiet(s, { type: 'tick' }, local(23, 40 + cfg.drowsyIdleMin + 1), cfg)
  assert.equal(s.state, 'drowsy')

  s = Q.reduceQuiet(s, { type: 'tick' }, local(23, 40 + cfg.quietIdleMin + 1), cfg)
  assert.equal(s.state, 'quiet')

  // 窗口外：drowsy 回 awake
  let d = Q.reduceQuiet(Q.emptyQuiet(local(23, 40)), { type: 'tick' }, local(23, 40 + cfg.drowsyIdleMin + 1), cfg)
  assert.equal(d.state, 'drowsy')
  d = Q.reduceQuiet(d, { type: 'tick' }, local(12, 0), cfg)
  assert.equal(d.state, 'awake')
})

test('canSpeak：drowsy 只放行 urgent，override 优先且会过期', () => {
  const cfg = Q.normalizeQuiet()
  const now = local(14, 0)
  let s = Q.emptyQuiet(now)
  s.state = 'drowsy'
  assert.deepEqual(Q.canSpeak(s, now), { ok: false, reason: 'drowsy' })
  assert.deepEqual(Q.canSpeak(s, now, { urgent: true }), { ok: true, reason: 'drowsy-urgent' })

  let q = Q.reduceQuiet(Q.emptyQuiet(local(23, 40)), { type: 'goodnight' }, local(23, 40), cfg)
  q = Q.reduceQuiet(q, { type: 'override', minutes: 10 }, local(23, 45), cfg)
  assert.equal(Q.canSpeak(q, local(23, 46)).ok, true)
  assert.equal(Q.canSpeak(q, local(23, 46)).reason, 'override')
  assert.equal(Q.canSpeak(q, local(23, 56)).ok, false, '破例应过期')
})

test('未知事件：不改变语义状态', () => {
  const cfg = Q.normalizeQuiet()
  const s = Q.emptyQuiet(local(20, 0))
  const r = Q.reduceQuiet(s, { type: 'nonsense' }, local(20, 1), cfg)
  assert.equal(r.state, s.state)
  assert.deepEqual(r.suppressed, s.suppressed)
})
