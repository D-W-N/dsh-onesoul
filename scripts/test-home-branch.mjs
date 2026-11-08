import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(here, '..', 'packages', 'dsh-companion-dashboard', 'lib', 'client.js')

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(')
  assert.ok(start >= 0, '找不到函数 ' + name)
  let depth = 0
  let index = source.indexOf('{', start)
  const open = index
  for (; index < source.length; index += 1) {
    const ch = source[index]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  throw new Error('函数 ' + name + ' 在 ' + open + ' 处没有闭合')
}

// 假 hooks：第一次 useState 直接给已加载的数据，避免依赖副作用
function render(runtime, moodLabel) {
  const data = {
    summary: '## 此刻的状态',
    runtime,
    rooms: [
      { id: 'living', name: '客厅' },
      { id: 'dining', name: '餐厅' },
      { id: 'balcony', name: '阳台' },
      { id: 'study', name: '书房' },
      { id: 'guest', name: '次卧' },
      { id: 'kitchen', name: '厨房·餐室' },
      { id: 'entry', name: '玄关' },
    ],
    moodLabel,
  }
  let stateCalls = 0
  const useState = () => {
    stateCalls += 1
    return stateCalls === 1 ? [data, () => {}] : [null, () => {}]
  }
  const useEffect = () => {}
  const useCallback = (fn) => fn
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  const Card = (props) => ({ type: 'Card', props: props || {}, children: [] })
  const apiGet = async () => data
  const apiPost = async () => data
  const source = readFileSync(CLIENT, 'utf8')
  const body = extractFunction(source, 'HomeBranch')
  const factory = new Function(
    'h', 'Card', 'useState', 'useEffect', 'useCallback', 'apiGet', 'apiPost', 'ANIMA',
    'return (' + body + ')',
  )
  const HomeBranch = factory(h, Card, useState, useEffect, useCallback, apiGet, apiPost, '/anima/api')
  return HomeBranch()
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit))
    return
  }
  if (node.type) visit(node)
  if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit))
}

const presence = { room: 'study', activity: '看书', since: '2026-11-08T06:00:00.000Z', moving: null, holdUntil: null, lastSeenAt: null, routine: [] }
const mood = { valence: 0.2, arousal: 0.3, since: null, lastAt: null, lastReason: '因为你说到「好」', topHits: [] }
const quiet = { state: 'awake', since: null, suppressed: [], overrideUntil: null }

{
  const tree = render({ presence, mood, quiet }, '平静')
  const buttons = []
  const texts = []
  walk(tree, (node) => {
    const style = node.props.style || {}
    if (style.height === '44px' && node.props.onClick) {
      buttons.push(node.children.join(''))
    }
    if (node.type === 'div' && typeof node.children[0] === 'string') texts.push(node.children.join(''))
  })
  assert.equal(buttons.length, 7, '七个房间都要可点')
  assert.ok(buttons.some((label) => label.includes('书房') && label.includes('·')), '当前房间要带 · 标记')
  const info = texts.find((text) => text.includes('说话门'))
  assert.ok(info && info.includes('书房') && info.includes('看书'), '位置行要写房间与动作：' + info)
  assert.ok(info.includes('平静'), '心情标签来自后端 moodLabel：' + info)
  assert.ok(info.includes('醒着'), '说话门要中文化：' + info)
  const grid = []
  walk(tree, (node) => {
    const style = node.props.style || {}
    if (style.gridTemplateColumns === 'repeat(3, 1fr)') grid.push(node)
  })
  assert.equal(grid.length, 1, '房间网格只有一处')
  console.log('ok 1/4 网格与位置行')
}

{
  const moving = { from: 'study', to: 'balcony', arriveAt: '2026-11-08T06:33:00.000Z', activity: '晒太阳' }
  const tree = render({ presence: { ...presence, moving }, mood, quiet }, '平静')
  const texts = []
  walk(tree, (node) => { if (node.type === 'div' && typeof node.children[0] === 'string') texts.push(node.children.join('')) })
  assert.ok(texts.some((text) => text.includes('正在去 阳台 的路上')), '走动中要写「正在去 … 的路上」')
  console.log('ok 2/4 走动文案')
}

{
  const tree = render({ presence: { ...presence, room: null, activity: null }, mood, quiet: { ...quiet, state: 'quiet' } }, '低落')
  const texts = []
  walk(tree, (node) => { if (node.type === 'div' && typeof node.children[0] === 'string') texts.push(node.children.join('')) })
  const info = texts.find((text) => text.includes('说话门'))
  assert.ok(info.includes('位置未知'), 'room 为 null 时要写位置未知：' + info)
  assert.ok(info.includes('静默中'), 'quiet 要中文：' + info)
  assert.ok(!info.includes('，undefined'), '没有 activity 时不能出现悬空逗号')
  console.log('ok 3/4 空位置与静默门')
}

{
  // 空数据（后端 rooms 为空）：不能抛，且网格保留占位
  const tree = render({ presence: { room: null, activity: null, moving: null }, mood, quiet }, '')
  const cells = []
  walk(tree, (node) => { if (node.props.style && node.props.style.height === '44px') cells.push(node) })
  assert.equal(cells.length, 7, '后端没给房间也要保留 7 个占位格')
  console.log('ok 4/4 空房间不崩')
}
