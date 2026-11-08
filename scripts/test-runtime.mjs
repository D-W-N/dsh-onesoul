/**
 * runtime 胶水层验收测试（协调者独立编写）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as R from '../packages/dsh-anima/lib/runtime.js'

const local = (h, m, day = 9) => new Date(2026, 10, day, h, m, 0, 0).toISOString()

test('runtimePath：落在 anima 目录下', () => {
  const p = R.runtimePath()
  assert.ok(p.endsWith('runtime.json'))
  assert.ok(p.includes('anima'))
})

test('emptyRuntime：三块都在，routine 是数组', () => {
  const r = R.emptyRuntime(local(10, 0))
  assert.ok(r.quiet && r.presence && r.mood)
  assert.ok(Array.isArray(r.routine) && r.routine.length > 0)
  assert.ok(r.quietCfg)
  assert.ok(r.updatedAt)
})

test('normalizeRuntime：脏输入不抛异常，缺字段补空', () => {
  assert.doesNotThrow(() => R.normalizeRuntime(undefined, local(10, 0)))
  const a = R.normalizeRuntime(null, local(10, 0))
  assert.ok(a.presence && a.mood && a.quiet)

  const b = R.normalizeRuntime({ quiet: { state: 'quiet' } }, local(10, 0))
  assert.equal(b.quiet.state, 'quiet', '已有的子状态不能被丢掉')
  assert.ok(Array.isArray(b.quiet.suppressed), '缺 suppressed 要补空数组')

  const c = R.normalizeRuntime({ routine: 'nonsense' }, local(10, 0))
  assert.ok(Array.isArray(c.routine) && c.routine.length > 0)
  assert.equal(R.normalizeRuntime('garbage', local(10, 0)).mood.valence >= -1, true)
})

test('applyRuntimeEvent：message 同时喂给三块', () => {
  const base = R.emptyRuntime(local(10, 0))
  const next = R.applyRuntimeEvent(base, { type: 'message', text: '被老板骂了，好难受！' }, local(10, 5))
  assert.ok(next.mood.valence < base.mood.valence, '心情应变差')
  assert.ok(next.presence.lastSeenAt, '位置模块应记下主人开口')
  assert.equal(next.updatedAt, local(10, 5))
  assert.equal(base.updatedAt, local(10, 0), '不得修改入参')
})

test('applyRuntimeEvent：goodnight 让静默门进 quiet，move-to 只动位置', () => {
  const base = R.applyRuntimeEvent(R.emptyRuntime(local(10, 0)), { type: 'move-to', room: 'study', activity: '看书' }, local(10, 1))
  assert.equal(base.presence.room, 'study')
  assert.equal(base.quiet.state, 'awake', 'move-to 不该碰静默门')

  const night = R.applyRuntimeEvent(base, { type: 'goodnight' }, local(23, 40))
  assert.equal(night.quiet.state, 'quiet')

  const moved = R.applyRuntimeEvent(night, { type: 'move-to', room: 'guest' }, local(23, 45))
  assert.equal(moved.quiet.state, 'quiet', 'move-to 不该把静默门弄醒')
})

test('applyRuntimeEvent：suppressed 入队、override 生效', () => {
  const night = R.applyRuntimeEvent(R.emptyRuntime(local(23, 40)), { type: 'goodnight' }, local(23, 40))
  const withItem = R.applyRuntimeEvent(night, { type: 'suppressed', kind: 'speak', text: '晚安' }, local(23, 41))
  assert.equal(withItem.quiet.suppressed.length, 1)

  const over = R.applyRuntimeEvent(withItem, { type: 'override', minutes: 5 }, local(23, 42))
  assert.ok(over.quiet.overrideUntil, '破例应写入 overrideUntil')
})

test('applyRuntimeEvent：tick 不炸，未知事件原样', () => {
  const base = R.emptyRuntime(local(10, 0))
  assert.doesNotThrow(() => R.applyRuntimeEvent(base, { type: 'tick' }, local(10, 30)))
  const u = R.applyRuntimeEvent(base, { type: 'nonsense' }, local(10, 30))
  assert.equal(u.presence.room, base.presence.room)
  assert.equal(u.mood.valence, base.mood.valence)
})

test('summarizeRuntime：四行结构 + 三种说话门', () => {
  const awake = R.summarizeRuntime(R.emptyRuntime(local(10, 0)), local(10, 0))
  assert.match(awake, /^## 此刻的状态/m)
  assert.match(awake, /- 位置：/)
  assert.match(awake, /- 心情：/)
  assert.match(awake, /- 说话门：.*醒着/)

  const night = R.applyRuntimeEvent(R.emptyRuntime(local(23, 40)), { type: 'goodnight' }, local(23, 40))
  const nightText = R.summarizeRuntime(night, local(23, 45))
  assert.match(nightText, /静默中/)
  assert.match(nightText, /23:40/, '应写本地起始时分')
  assert.match(nightText, /0 条待说|压着/)

  const withItems = R.applyRuntimeEvent(R.applyRuntimeEvent(night, { type: 'suppressed', kind: 'speak', text: '晚安' }, local(23, 41)), { type: 'suppressed', kind: 'speak', text: '想你' }, local(23, 42))
  const t2 = R.summarizeRuntime(withItems, local(23, 43))
  assert.match(t2, /2 条/)
  assert.match(t2, /攒着的话/)

  const sleepy = { ...R.emptyRuntime(local(23, 0)), quiet: { ...R.emptyRuntime(local(23, 0)).quiet, state: 'drowsy' } }
  assert.match(R.summarizeRuntime(sleepy, local(23, 5)), /半睡/)
})

test('summarizeRuntime：心情很差时给提醒，且坏输入不抛', () => {
  const bad = R.normalizeRuntime({ mood: { valence: -0.8, arousal: 0.6, lastAt: local(10, 0), lastReason: '因为你说到「骂」', topHits: [] } }, local(10, 0))
  assert.match(R.summarizeRuntime(bad, local(10, 0)), /先接住情绪/)

  assert.doesNotThrow(() => R.summarizeRuntime({}, local(10, 0)))
  assert.doesNotThrow(() => R.summarizeRuntime(null, 'not-a-date'))
  assert.match(R.summarizeRuntime(null, local(10, 0)), /## 此刻的状态/)
})
