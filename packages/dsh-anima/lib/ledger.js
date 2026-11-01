import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { animaDir, nowIso } from './store.js'

export function ledgerPath() {
  return join(animaDir(), 'ledger.jsonl')
}

/** Stable JSON: keys sorted, so the same record always hashes the same. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value)
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const keys = Object.keys(value).filter(function (key) { return value[key] !== undefined }).sort()
  return '{' + keys.map(function (key) { return JSON.stringify(key) + ':' + canonical(value[key]) }).join(',') + '}'
}

export function hashOf(prev, payload) {
  return createHash('sha256').update(String(prev) + '\n' + canonical(payload)).digest('hex')
}

export function readLedger() {
  const path = ledgerPath()
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(function (line) {
    try { return JSON.parse(line) } catch { return { broken: true, raw: line } }
  })
}

/** Append one record: prev 指向上一条的 hash，第一条用 GENESIS。 */
export function appendLedger(op, payload) {
  const rows = readLedger()
  const prev = rows.length ? String(rows[rows.length - 1].hash || 'BROKEN') : 'GENESIS'
  const body = payload || {}
  const record = { seq: rows.length + 1, t: nowIso(), op: op, ...body }
  record.prev = prev
  record.hash = hashOf(prev, body)
  try {
    mkdirSync(animaDir(), { recursive: true })
    appendFileSync(ledgerPath(), JSON.stringify(record) + '\n', 'utf8')
  } catch (error) {
    return { record: record, appended: false, error: String(error && error.message ? error.message : error) }
  }
  return { record: record, appended: true }
}

/** 重算整条链：改一个字段、删一行、插一行，都会在这里报红。 */
export function verifyLedger() {
  const rows = readLedger()
  let prev = 'GENESIS'
  const problems = []
  rows.forEach(function (row, index) {
    if (!row || row.broken) { problems.push({ seq: index + 1, reason: 'json 无法解析' }); prev = 'BROKEN'; return }
    if (row.seq !== index + 1) problems.push({ seq: index + 1, reason: 'seq 断号（期望 ' + (index + 1) + '，实为 ' + row.seq + '）' })
    if (String(row.prev) !== prev) problems.push({ seq: index + 1, reason: 'prev 指针对不上' })
    const payload = { ...row }
    delete payload.seq
    delete payload.t
    delete payload.op
    delete payload.prev
    delete payload.hash
    if (hashOf(prev, payload) !== row.hash) problems.push({ seq: index + 1, reason: 'hash 不匹配（内容被改过）' })
    prev = String(row.hash)
  })
  return { ok: problems.length === 0, entries: rows.length, path: ledgerPath(), problems: problems.slice(0, 20) }
}
