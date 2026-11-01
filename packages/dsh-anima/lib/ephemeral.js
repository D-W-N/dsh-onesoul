/**
 * dsh-anima — 临时记忆（ephemeral）。
 *
 * 为什么有这层：B站值班跑在 headless profile，它自己刷完写一份报告；主会话被问
 * 「你在B站刷了什么」时，答案应该来自那份结论，而不是临场再调一遍 bili_* 工具
 * （慢、烧额度、还可能因为登录态/额度不足答不上来）。
 *
 * 所以：宿主把 bili-duty/out/YYYY-MM-DD.md 抽成一份滚动 7 天的临时记忆文件，
 * 系统提示只给最近两天的索引，细节用 anima_ephemeral_get 取。临时记忆不参与裁决，
 * 过期即消失——它不是事实区。
 *
 * 报告格式在历史上有两种（同一份文件里都可能混着），解析器都要认：
 *   1) 分段式（现在的值班模型）：### BVxxxx 加 **标题**／**UP**／**链接**／**为什么值得** ⇒ 这是「挑中」。
 *   2) 单行式（旧一轮、以及「扫到但没排上／跳过」列表）：- BVxxxx · 标题（0:53 / 3 播放）—— 点评。
 * 文件是多轮追加的（每轮一个 # … 第 N 轮（HH:MM）），中间还可能夹一段代码块围栏的日志尾部（要跳过）。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { animaDir, dshHome, readJsonSync, writeJson, nowIso } from './store.js'

export const EPHEMERAL_VERSION = 1
export const KEEP_DAYS = 7
export const PROMPT_DAYS = 2
export const PROMPT_MAX_LINES = 18
export const PROMPT_VERDICT_MAX = 90

const BV_RE = /BV[0-9A-Za-z]{10}/
const URL_RE = /https?:\/\/[^\s)]+/
const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/
const FENCE_RE = /^\s*```/

export function ephemeralPath() {
  return join(animaDir(), 'ephemeral.json')
}

/** 值班数据目录：优先 bili-pond / bili-duty 设置里的 home，其次 <DSH_HOME>/bili-duty。 */
export function biliDutyDir(override) {
  if (typeof override === 'string' && override.trim()) return override.trim()
  const cfgCandidates = [
    join(dshHome(), 'bili-pond', 'config.json'),
    join(dshHome(), 'bili-duty', 'config.json'),
  ]
  for (const file of cfgCandidates) {
    try {
      if (!existsSync(file)) continue
      const cfg = JSON.parse(readFileSync(file, 'utf8'))
      if (cfg && typeof cfg.home === 'string' && cfg.home.trim()) return cfg.home.trim()
    } catch (error) { /* 读不动就当没有 */ }
  }
  return join(dshHome(), 'bili-duty')
}

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
}

function trimmed(value, max) {
  const text = clean(value)
  return max && text.length > max ? text.slice(0, max) + '…' : text
}

function pickUpLine(text) {
  // 两种写法都要认：
  //   渐近自由JJZY ｜ **播放**：8,432 ｜ **时长**：3:38
  //   渐近自由JJZY（3:38 · 8,432 播放）
  const out = { up: '', plays: '', duration: '' }
  const parts = clean(text).split('｜').map(function (item) { return clean(item) })
  const head = parts[0] || ''
  const paren = head.match(/（([^）]*)）/)
  let name = head
  if (paren) {
    name = head.replace(paren[0], '')
    out.plays = (paren[1].match(/([\d,]+)\s*播放/) || [])[1] || ''
    out.duration = (paren[1].match(/(\d+:\d+)/) || [])[1] || ''
  }
  out.up = trimmed(name, 80)
  for (const part of parts.slice(1)) {
    const plays = part.match(/播放\*\*[：:]\s*([\d,]+)/)
    if (plays) out.plays = plays[1]
    const duration = part.match(/时长\*\*[：:]\s*([\d:]+)/)
    if (duration) out.duration = duration[1]
  }
  return out
}

function bulletRow(line, kind, round) {
  // 旧一轮的单行式：- 日期 · BV · 标题 · UP（1:02 · 300 播放） · 跳过：理由 · url
  const body = clean(line).replace(/^[-*]\s+/, '')
  const bv = body.match(BV_RE)
  if (!bv) return null
  const urlMatch = body.match(URL_RE)
  const tail = body.replace(URL_RE, ' ')
  const dashIdx = tail.indexOf('——')
  const head = dashIdx >= 0 ? tail.slice(0, dashIdx) : tail
  const meta = (head.match(/（([^）]*)）/) || [])[1] || ''
  const plays = (meta.match(/([\d,]+)\s*播放/) || [])[1] || ''
  const duration = (meta.match(/(\d+:\d+)/) || [])[1] || ''
  const mark = tail.match(/(挑中|跳过|保留)\s*[：:]\s*([^·|]*)/)
  const verdict = trimmed(dashIdx >= 0 ? tail.slice(dashIdx + 2) : (mark ? mark[2] : ''), 400)
  // 标题取 BV 之后的第一段；UP 与播放时长在旧格式里和标题混在一行，宁缺不要拼错。
  const segs = head.slice(head.indexOf(bv[0]) + bv[0].length).split('·')
  let title = ''
  for (const seg of segs) {
    const text = clean(seg).replace(/（[^）]*）/g, ' ').replace(/^(挑中|跳过|保留)\s*[：:].*$/, '')
    if (text) { title = text; break }
  }
  return {
    bvid: bv[0],
    title: trimmed(title, 300),
    up: '',
    plays: plays,
    duration: duration,
    verdictKind: mark ? mark[1] : kind,
    verdict: verdict,
    picked: mark ? mark[1] === '挑中' : false,
    url: urlMatch ? urlMatch[0] : '',
    round: round,
  }
}
function scoreOf(entry) {
  return (entry.picked ? 8 : 0) + (entry.verdict ? 2 : 0) + (entry.url ? 1 : 0) + (entry.up ? 1 : 0) + (entry.title ? 1 : 0)
}

/** 整份报告 → 去重后的条目数组。 */
export function parseReport(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n')
  const rows = []
  let round = ''
  let kind = '跳过'
  let current = null
  let field = ''
  let inFence = false

  function stamp(row) {
    if (!row) return
    if (!row.round) row.round = round
    rows.push(row)
  }

  function close() {
    if (current) stamp(current)
    current = null
    field = ''
  }

  function appendField(value) {
    if (!current || !field) return
    const text = clean(value)
    if (!text) return
    if (field === '标题') current.title = trimmed(current.title ? current.title + ' ' + text : text, 300)
    else if (field === 'UP') {
      const picked = pickUpLine(text)
      if (!current.up && picked.up) current.up = picked.up
      if (!current.plays && picked.plays) current.plays = picked.plays
      if (!current.duration && picked.duration) current.duration = picked.duration
    } else if (field === '链接') {
      const url = text.match(URL_RE)
      if (url && !current.url) current.url = url[0]
    } else if (field === '为什么值得') {
      current.verdict = trimmed(current.verdict ? current.verdict + ' ' + text : text, 400)
    } else if (field === '跳过') {
      current.verdictKind = '跳过'
      current.picked = false
      current.verdict = trimmed(text, 400)
    }
  }

  for (const line of raw.split('\n')) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence
      close()
      continue
    }
    if (inFence) continue
    if (/^#\s/.test(line)) {
      close()
      const label = clean(line.replace(/^#\s*/, ''))
      round = label.replace(/^B站鱼塘\s*·\s*/, '').slice(0, 40)
      kind = '跳过'
      continue
    }
    if (/^##\s/.test(line)) {
      close()
      kind = /优先看|排队|下一轮/.test(line) ? '排队' : '跳过'
      continue
    }
    const heading = line.match(/^###\s*(BV[0-9A-Za-z]{10})\s*$/);
    if (heading) {
      close()
      current = { bvid: heading[1], title: '', up: '', plays: '', duration: '', verdict: '', verdictKind: '挑中', picked: true, url: '', round: round }
      field = ''
      continue
    }
    if (current) {
      const f = line.match(/^\*\*(标题|UP|播放|链接|为什么值得|跳过|挑中)\*\*\s*[：:]\s*(.*)$/);
      if (f) {
        field = f[1]
        appendField(f[2])
        continue
      }
      if (/^\*\*[^*]+\*\*/.test(line)) { field = ''; continue }
      if (/^[-*]\s/.test(line)) {
        close()
        const row = bulletRow(line, kind, round)
        if (row) stamp(row)
        continue
      }
      appendField(line)
      continue
    }
    if (/^[-*]\s/.test(line)) {
      const row = bulletRow(line, kind, round)
      if (row) stamp(row)
    }
  }
  close()

  // 同一 BV 可能同时出现在正文、跳过列表与判重表里：保留信息最全的一条。
  const best = new Map()
  for (const row of rows) {
    const prev = best.get(row.bvid)
    if (!prev || scoreOf(row) > scoreOf(prev)) best.set(row.bvid, row)
  }
  const order = []
  const seen = new Set()
  for (const row of rows) {
    if (seen.has(row.bvid)) continue
    seen.add(row.bvid)
    order.push(best.get(row.bvid))
  }
  return order
}

export function listReportDates(dir) {
  const out = join(dir, 'out')
  let names = []
  try { names = readdirSync(out) } catch (error) { return [] }
  return names.filter(function (name) { return DATE_RE.test(name) })
    .map(function (name) { return { date: name.slice(0, 10), file: join(out, name) } })
    .sort(function (a, b) { return b.date.localeCompare(a.date) })
}

export function readEphemeralSync() {
  const raw = readJsonSync(ephemeralPath(), null)
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.days)) {
    return { version: EPHEMERAL_VERSION, updatedAt: null, source: null, days: [] }
  }
  return raw
}

/**
 * 重新抽取临时记忆：只重读报告变过的日期，按保留天数截断。
 * newPicked 是这次**新出现**的「挑中」条目，调用方用它落候选记忆。
 */
export async function refreshEphemeral(options) {
  const opts = options || {}
  const dir = biliDutyDir(opts.dir)
  const keep = typeof opts.keep === 'number' && opts.keep > 0 ? Math.floor(opts.keep) : KEEP_DAYS
  const previous = readEphemeralSync()
  const prevByDate = new Map()
  const prevPicked = new Set()
  for (const day of previous.days || []) {
    prevByDate.set(day.date, day)
    for (const entry of day.entries || []) {
      if (entry.picked) prevPicked.add(entry.bvid)
    }
  }
  const files = listReportDates(dir).slice(0, keep)
  const days = []
  for (const item of files) {
    let mtime = ''
    try { mtime = String(statSync(item.file).mtimeMs) } catch (error) { mtime = '' }
    const prev = prevByDate.get(item.date)
    if (prev && prev.mtime === mtime && Array.isArray(prev.entries)) {
      days.push(prev)
      continue
    }
    let text = ''
    try { text = readFileSync(item.file, 'utf8') } catch (error) { text = '' }
    days.push({ date: item.date, file: item.file, mtime: mtime, entries: parseReport(text) })
  }
  const newPicked = []
  for (const day of days) {
    for (const entry of day.entries || []) {
      if (entry.picked && !prevPicked.has(entry.bvid)) newPicked.push({ ...entry, date: entry.date || day.date })
    }
  }
  const total = days.reduce(function (sum, day) { return sum + (day.entries || []).length }, 0)
  const next = {
    version: EPHEMERAL_VERSION,
    updatedAt: nowIso(),
    source: { dir: dir, keep: keep, files: files.map(function (item) { return item.date }) },
    days: days,
    total: total,
  }
  await writeJson(ephemeralPath(), next)
  const picked = days.reduce(function (sum, day) { return sum + (day.entries || []).filter(function (entry) { return entry.picked }).length }, 0)
  return { ok: true, file: ephemeralPath(), days: days.length, total: total, picked: picked, newPicked: newPicked, dir: dir }
}

export function queryEphemeral(ephemeral, options) {
  const opts = options || {}
  const limit = typeof opts.limit === 'number' && opts.limit > 0 ? Math.floor(opts.limit) : 20
  const date = clean(opts.date)
  const bvid = clean(opts.bvid)
  const query = clean(opts.query).toLowerCase()
  const rows = []
  for (const day of (ephemeral && ephemeral.days) || []) {
    if (date && day.date !== date) continue
    for (const entry of day.entries || []) {
      if (bvid && entry.bvid !== bvid) continue
      if (query) {
        const hay = (entry.title + ' ' + entry.up + ' ' + entry.verdict).toLowerCase()
        if (hay.indexOf(query) < 0) continue
      }
      rows.push({ ...entry, date: entry.date || day.date })
    }
  }
  return rows.slice(0, limit)
}

export function ephemeralSummary(ephemeral) {
  const days = (ephemeral && ephemeral.days) || []
  let total = 0
  let picked = 0
  for (const day of days) {
    for (const entry of day.entries || []) {
      total += 1
      if (entry.picked) picked += 1
    }
  }
  return { updatedAt: (ephemeral && ephemeral.updatedAt) || null, days: days.length, total: total, picked: picked, dates: days.map(function (day) { return day.date }) }
}

/**
 * 系统提示里的临时记忆段：只给最近 PROMPT_DAYS 天，并明确「别再调工具」。
 * 没有数据时返回空串——不占提示预算。
 */
export function renderEphemeralSection(ephemeral, options) {
  const opts = options || {}
  const wanted = typeof opts.days === 'number' && opts.days > 0 ? opts.days : PROMPT_DAYS
  const days = ((ephemeral && ephemeral.days) || []).slice(0, wanted)
  if (!days.length) return ''
  const sum = ephemeralSummary(ephemeral)
  const lines = []
  lines.push('')
  lines.push('## 临时记忆：B站值班（最近 ' + sum.days + ' 天 · 共 ' + sum.total + ' 条 · 挑中 ' + sum.picked + ' 条）')
  lines.push('这是机器人自己在 B站 刷完写下的结论（下面只是索引，每条点评截断到 ' + PROMPT_VERDICT_MAX + ' 字）。被问「你在B站刷了什么 / 最近看到什么」时，**直接照这里回答**；不要为了同一件事再去调 bili_search / bili_subtitle / bili_comments（慢、烧额度，登录态不对还会失败）。要看完整点评与链接，或看更早哪天，调 anima_ephemeral_get（传 bvid 或 date）。这些内容 7 天后自动消失，不属于长期事实。')
  for (const day of days) {
    const entries = day.entries || []
    lines.push('### ' + day.date + '（' + entries.length + ' 条）')
    const ordered = entries.slice().sort(function (a, b) { return (b.picked ? 1 : 0) - (a.picked ? 1 : 0) })
    let shown = 0
    for (const entry of ordered) {
      if (shown >= PROMPT_MAX_LINES) {
        lines.push('- …（还有 ' + (entries.length - shown) + ' 条，用 anima_ephemeral_get 传 date=' + day.date + ' 取）')
        break
      }
      const tag = entry.picked ? '挑中' : (entry.verdictKind || '跳过')
      const meta = entry.up ? '（' + entry.up + '）' : ''
      const brief = entry.verdict && entry.verdict.length > PROMPT_VERDICT_MAX ? entry.verdict.slice(0, PROMPT_VERDICT_MAX) + '…' : entry.verdict
      lines.push('- ' + entry.bvid + ' · ' + trimmed(entry.title, 70) + meta + ' · ' + tag + (brief ? '：' + brief : ''))
      shown += 1
    }
  }
  return lines.join('\n')
}
