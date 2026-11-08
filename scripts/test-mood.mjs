/**
 * 心情评估验收测试（协调者独立编写）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as M from '../packages/dsh-anima/lib/mood.js'

const local = (h, m, day = 9) => new Date(2026, 10, day, h, m, 0, 0).toISOString()

test('emptyMood：贴着底色，字段齐全', () => {
  const s = M.emptyMood(local(10, 0))
  assert.equal(typeof s.valence, 'number')
  assert.equal(typeof s.arousal, 'number')
  assert.ok(Math.abs(s.valence - M.BASELINE.valence) < 1e-9)
  assert.ok(Math.abs(s.arousal - M.BASELINE.arousal) < 1e-9)
  assert.ok(s.since)
  assert.deepEqual(s.topHits, [])
})

test('analyzeMessage：正负中性与空输入', () => {
  const pos = M.analyzeMessage('今天太好了，谢谢你')
  assert.ok(pos.valence > 0, `期望正效价，实得 ${pos.valence}`)
  assert.ok(pos.hits.length > 0)

  const neg = M.analyzeMessage('我好累啊，烦死了')
  assert.ok(neg.valence < 0)

  const none = M.analyzeMessage('嗯')
  assert.deepEqual(none, { valence: 0, arousal: 0, hits: [] })

  assert.deepEqual(M.analyzeMessage(null), { valence: 0, arousal: 0, hits: [] })
  assert.deepEqual(M.analyzeMessage(''), { valence: 0, arousal: 0, hits: [] })
})

test('analyzeMessage：否定前缀要翻面', () => {
  const plain = M.analyzeMessage('开心')
  const negated = M.analyzeMessage('不开心')
  assert.ok(plain.valence > 0)
  assert.ok(negated.valence < 0, `「不开心」应判负，实得 ${negated.valence}`)

  const negWord = M.analyzeMessage('不难过')
  assert.ok(negWord.valence >= 0, `「不难过」不该是负的，实得 ${negWord.valence}`)
})

test('analyzeMessage：感叹号抬唤醒，calm 词降唤醒', () => {
  const flat = M.analyzeMessage('好累')
  const loud = M.analyzeMessage('好累！！！')
  assert.ok(loud.arousal > flat.arousal)

  const calm = M.analyzeMessage('想安安静静睡一会儿')
  assert.ok(calm.arousal < 0.5)
})

test('analyzeMessage：repeatCount 放大但不出界', () => {
  const one = M.analyzeMessage('累')
  const three = M.analyzeMessage('累', { repeatCount: 3 })
  assert.ok(three.valence < one.valence, '重复负面应更负')
  assert.ok(three.valence >= -1 && three.valence <= 1)
  const wild = M.analyzeMessage('累', { repeatCount: 99 })
  assert.ok(wild.valence >= -1, 'repeatCount 再大也不能爆到 -1 以下')
})

test('reduceMood：message 让心情跟着话走，并留下理由', () => {
  let s = M.emptyMood(local(10, 0))
  const before = s.valence
  s = M.reduceMood(s, { type: 'message', text: '今天太好了，谢谢你' }, local(10, 1))
  assert.ok(s.valence > before)
  assert.match(s.lastReason, /好棒|谢谢|太好了/)

  let t = M.emptyMood(local(10, 0))
  t = M.reduceMood(t, { type: 'message', text: '我好累' }, local(10, 1))
  assert.ok(t.valence < M.BASELINE.valence)
  assert.match(t.lastReason, /累/)
})

test('reduceMood：长时间没消息会让气氛冷下来', () => {
  const fresh = M.reduceMood(M.emptyMood(local(10, 0)), { type: 'message', text: '好累！', latencyMin: 1 }, local(10, 1))
  const stale = M.reduceMood(M.emptyMood(local(10, 0)), { type: 'message', text: '好累！', latencyMin: 90 }, local(11, 30))
  assert.ok(stale.arousal < fresh.arousal)
})

test('reduceMood：tick 向底色衰减，且一次不跳太多', () => {
  let s = M.reduceMood(M.emptyMood(local(10, 0)), { type: 'message', text: '气死我了！！！' }, local(10, 1))
  const peak = s.valence
  s = M.reduceMood(s, { type: 'tick' }, local(10, 2))
  assert.ok(s.valence > peak, '一分钟应往底色靠一点')

  const wild = M.reduceMood({ ...s, valence: -1, lastAt: local(9, 0) }, { type: 'tick' }, local(23, 0))
  assert.ok(wild.valence - -1 <= 0.5001, '一次 tick 最多靠拢 0.5')
  assert.ok(wild.valence <= M.BASELINE.valence + 1e-9)
})

test('reduceMood：goodnight / goodmorning 的效果', () => {
  let s = M.reduceMood(M.emptyMood(local(23, 0)), { type: 'goodnight' }, local(23, 30))
  assert.ok(s.arousal <= 0.15 + 1e-9, `睡前唤醒应压低，实得 ${s.arousal}`)
  s = M.reduceMood(s, { type: 'goodmorning' }, local(7, 30, 10))
  assert.ok(s.arousal >= M.BASELINE.arousal)
  assert.ok(s.valence >= 0)
})

test('valenceLabel：五档边界', () => {
  assert.equal(M.valenceLabel(0.9), '很好')
  assert.equal(M.valenceLabel(0.5), '很好')
  assert.equal(M.valenceLabel(0.2), '不错')
  assert.equal(M.valenceLabel(0), '平静')
  assert.equal(M.valenceLabel(-0.3), '低落')
  assert.equal(M.valenceLabel(-0.9), '很差')
  assert.equal(M.valenceLabel('x'), '平静')
})

test('describeMood：一句话带理由', () => {
  let s = M.emptyMood(local(10, 0))
  assert.match(M.describeMood(s, local(10, 0)), /^她心情/)
  s = M.reduceMood(s, { type: 'message', text: '你真好，谢谢你' }, local(10, 1))
  const line = M.describeMood(s, local(10, 1))
  assert.match(line, /她心情/)
  assert.match(line, /——/)
  assert.match(line, /谢谢|好|真好/)
})

test('suggestMusic：四象限 + 日常', () => {
  const up = { valence: 0.6, arousal: 0.8, lastAt: local(10, 0), lastReason: '' }
  assert.deepEqual(M.suggestMusic(up).tag, '轻快')
  assert.match(M.suggestMusic(up).why, /高兴|轻快|欢/)

  const warm = { valence: 0.6, arousal: 0.2, lastAt: local(10, 0), lastReason: '' }
  assert.equal(M.suggestMusic(warm).tag, '温暖')

  const vent = { valence: -0.6, arousal: 0.8, lastAt: local(10, 0), lastReason: '' }
  assert.equal(M.suggestMusic(vent).tag, '宣泄')
  assert.match(M.suggestMusic(vent).why, /响/)

  const quiet = { valence: -0.6, arousal: 0.2, lastAt: local(10, 0), lastReason: '' }
  assert.equal(M.suggestMusic(quiet).tag, '安静')
  assert.match(M.suggestMusic(quiet).why, /吵/)

  const mid = { valence: 0.1, arousal: 0.4, lastAt: local(10, 0), lastReason: '' }
  assert.equal(M.suggestMusic(mid).tag, '日常')
})

test('纯函数与未知事件', () => {
  const s = M.emptyMood(local(10, 0))
  const snapshot = JSON.stringify(s)
  M.reduceMood(s, { type: 'message', text: '好累' }, local(10, 1))
  assert.equal(JSON.stringify(s), snapshot, '不得修改入参')

  const u = M.reduceMood(s, { type: 'nonsense' }, local(10, 2))
  assert.equal(u.valence, s.valence)
  assert.equal(u.arousal, s.arousal)
})
