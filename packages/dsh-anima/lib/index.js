/**
 * dsh-anima — 灵魂层。
 *
 * 四件事：人格定义（全局 + 按工作区覆盖）、长期记忆候选捕获、用户裁决闸门、系统提示词注入。
 * 记忆绝不自动写入：capture 只进候选池，只有 decide(approve) 才成为事实。
 */
import { createServer } from 'node:http'
import { appendFileSync, createReadStream, statSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { createSocket } from 'node:dgram'
import { isIPv4 } from 'node:net'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { animaDir, ensureDirSync, memoryPath, newId, nowIso, personaPath, readJsonSync, settingsPath, stampOf, writeJson } from './store.js'
import {
  DEFAULT_PERSONA,
  PERSONA_FIELDS,
  approvedMemories,
  effectivePersona,
  emptyMemory,
  emptyState,
  extractCandidateTexts,
  normalizeMemory,
  normalizeState,
  pendingMemories,
  renderPromptSection,
  findMemory,
  memoryIndex,
  revokeMemories,
  memoryApplies,
  normalizeSettings,
} from './model.js'
import { appendLedger, ledgerPath, verifyLedger } from './ledger.js'
import {
  KEEP_DAYS,
  ephemeralPath,
  ephemeralSummary,
  queryEphemeral,
  readEphemeralSync,
  refreshEphemeral,
  renderEphemeralSection,
} from './ephemeral.js'
import { applyRuntimeEvent, normalizeRuntime, runtimePath, summarizeRuntime } from './runtime.js'
import { ROOMS, describePresence, roomById } from './presence.js'
import { describeMood, valenceLabel } from './mood.js'
import { canSpeak, noteSuppressed } from './quiet.js'
import { speak, synthesize } from './voice.js'
import * as xiaomi from './xiaomi.js'

export { KEEP_DAYS, readEphemeralSync, refreshEphemeral, queryEphemeral, renderEphemeralSection, ephemeralSummary }
export const name = 'dsh-anima'
// webServer 是可选的：headless 值班 profile 里没有这个服务，硬依赖会让插件永远不激活。
// 路由在 webServer 存在时才挂（桌面/网页 profile 都有），值班 profile 只用工具与提示注入。
export const inject = ['tools', 'systemPrompt', 'agents', 'agentDefaultModel']

const ROUTE = '/anima/api'
const SECTION_NAME = 'companion:anima'

function textOf(value) {
  return [{ type: 'text', text: value }]
}

function isLoopback(address) {
  const raw = String(address || '')
  return raw === '::1' || raw === '127.0.0.1' || raw.startsWith('127.') || raw === 'localhost' || raw === '::ffff:127.0.0.1'
}

function denyNonLoopback(req, res, allowLan) {
  if (allowLan) return false
  const remote = req && req.socket ? req.socket.remoteAddress : ''
  if (isLoopback(remote)) return false
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: 'loopback-only', detail: '当前 anima 只接受本机访问；如需局域网访问请把配置 allowLan 设为 true。' }))
  return true
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let total = 0
    const chunks = []
    req.on('data', function (chunk) {
      total += chunk.length
      if (total > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', function () {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

export function apply(ctx, pluginConfig) {
  const config = pluginConfig || {}
  const allowLan = config.allowLan === true
  // 值班 profile 整个进程都算 Onesoul 通道（它没有 QQ 那种会话 id 前缀可认）。
  const channelProfile = config.channelProfile === true
  const state = { persona: emptyState(), memory: emptyMemory(), settings: normalizeSettings(null), personaStamp: '', memoryStamp: '', settingsStamp: '', runtime: normalizeRuntime(null, nowIso()), runtimeStamp: '', cwd: '' }
  let chain = Promise.resolve()

  function serialize(task) {
    const next = chain.then(task, task)
    chain = next.then(function () {}, function () {})
    return next
  }

  /** Reload from disk when the file changed underneath us (dashboard or another process wrote it). */
  function refreshSync() {
    const pStamp = stampOf(personaPath())
    if (pStamp !== state.personaStamp) {
      state.personaStamp = pStamp
      state.persona = normalizeState(readJsonSync(personaPath(), null))
    }
    const mStamp = stampOf(memoryPath())
    if (mStamp !== state.memoryStamp) {
      state.memoryStamp = mStamp
      state.memory = normalizeMemory(readJsonSync(memoryPath(), null))
    }
    const sStamp = stampOf(settingsPath())
    if (sStamp !== state.settingsStamp) {
      state.settingsStamp = sStamp
      state.settings = normalizeSettings(readJsonSync(settingsPath(), null))
    }
    const rStamp = stampOf(runtimePath())
    // 写盘期间 stamp 是 'writing'，这时读盘会拿到半截/旧内容把内存里的新事件盖掉
    if (state.runtimeStamp !== 'writing' && rStamp !== state.runtimeStamp) {
      state.runtimeStamp = rStamp
      state.runtime = normalizeRuntime(readJsonSync(runtimePath(), null), nowIso())
    }
  }

  async function persistPersona() {
    state.personaStamp = 'writing'
    await writeJson(personaPath(), state.persona)
    state.personaStamp = stampOf(personaPath())
  }

  async function persistSettings() {
    state.settingsStamp = 'writing'
    await writeJson(settingsPath(), state.settings)
    state.settingsStamp = stampOf(settingsPath())
  }

  async function persistRuntime() {
    state.runtimeStamp = 'writing'
    try {
      await writeJson(runtimePath(), state.runtime)
    } finally {
      state.runtimeStamp = stampOf(runtimePath())
    }
  }

  // 停留/破例时长：给了就取合法分钟数，超过一天按一天算，其它（NaN、负数、空）一律当作没给
  // 控制中心发来的事件：点房间 = move-to，晚安/早安/破例 = quiet，顺手说一句 = message
  function normalizeUiEvent(body) {
    const type = String((body && body.type) || '')
    if (type === 'move-to') {
      const room = String((body && body.room) || '').trim()
      if (!roomById(room)) throw new Error('没有这个房间：' + room)
      return {
        type: 'move-to',
        room: room,
        activity: typeof body.activity === 'string' ? body.activity.slice(0, 80) : undefined,
        minutes: minutesOfStay(body.minutes),
      }
    }
    if (type === 'goodnight' || type === 'goodmorning' || type === 'override' || type === 'suppressed') {
      return {
        type: type,
        minutes: minutesOfStay(body.minutes),
        text: typeof body.text === 'string' ? body.text.slice(0, 500) : undefined,
        kind: typeof body.kind === 'string' ? body.kind.slice(0, 40) : undefined,
      }
    }
    if (type === 'tick') return { type: 'tick' }
    if (type === 'message') {
      const text = String((body && body.text) || '').trim()
      if (!text) throw new Error('text 不能为空')
      return { type: 'message', text: text.slice(0, 2000) }
    }
    throw new Error('不支持的事件类型：' + type)
  }

  function minutesOfStay(value) {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return undefined
    return Math.min(Math.round(n), 1440)
  }

  async function persistMemory() {
    state.memoryStamp = 'writing'
    await writeJson(memoryPath(), state.memory)
    state.memoryStamp = stampOf(memoryPath())
  }

  // ---- 临时记忆（B站值班结论）：缓存按文件戳失效，抽取走 serialize 防并发写 ----
  const ephemeralCache = { stamp: '', data: null }

  function ephemeralSync() {
    const stamp = stampOf(ephemeralPath())
    if (stamp !== ephemeralCache.stamp) {
      ephemeralCache.stamp = stamp
      ephemeralCache.data = readEphemeralSync()
    }
    return ephemeralCache.data
  }

  /** 临时记忆是自动写入的旁路：值班挑中的条目不进候选池，也就永远不需要用户裁决。 */
  function refreshEphemeralSafe(reason) {
    return serialize(async function () {
      try {
        const result = await refreshEphemeral({ keep: KEEP_DAYS })
        ephemeralCache.stamp = stampOf(ephemeralPath())
        ephemeralCache.data = readEphemeralSync()
        return { ...result, captured: 0, reason: reason || 'tick' }
      } catch (error) {
        ctx.logger && ctx.logger.warn && ctx.logger.warn('[dsh-anima] 临时记忆抽取失败：' + (error && error.message ? error.message : error))
        return { ok: false, error: error && error.message ? error.message : String(error) }
      }
    })
  }

  /** 会话身份：QQ 通道的会话 id 形如 onebot-private-<uin> / onebot-group-<gid>。 */
  function channelIdOf(context) {
    try {
      const agent = context && context.agent
      if (!agent) return ''
      const id = agent.id || (agent.session && agent.session.id) || ''
      return typeof id === 'string' ? id : ''
    } catch (error) {
      return ''
    }
  }

  function summarize() {
    refreshSync()
    const pending = pendingMemories(state.memory)
    const approved = state.memory.entries.filter(function (entry) { return entry.status === 'approved' })
    const rejected = state.memory.entries.filter(function (entry) { return entry.status === 'rejected' })
    const picked = effectivePersona(state.persona, state.cwd)
    return {
      home: animaDir(),
      personas: { global: state.persona.global, workspaces: Object.keys(state.persona.workspaces) },
      effective: picked.persona,
      overridden: picked.overridden,
      counts: { pending: pending.length, approved: approved.length, rejected: rejected.length },
      ephemeral: ephemeralSummary(ephemeralSync()),
      memoryScope: state.settings.memoryScope,
      channelPrefixes: state.settings.channelPrefixes,
      channelProfile: channelProfile,
    }
  }

  // ---- system prompt injection: the single reason all channels share one soul ----
  let systemPrompt = null
  try { systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : null } catch (error) { systemPrompt = null }
  if (!systemPrompt) { try { systemPrompt = ctx.systemPrompt || null } catch (error) { systemPrompt = null } }
  if (systemPrompt && typeof systemPrompt.section === 'function') {
    ctx.effect(function () {
      return systemPrompt.section({
        name: SECTION_NAME,
        order: 5,
        text: function (context) {
          try {
            refreshSync()
            const channelId = channelIdOf(context)
            const applies = channelProfile === true || memoryApplies(state.settings, channelId)
            if (!applies) return ''
            return renderPromptSection(state.persona, state.memory, state.cwd) + renderEphemeralSection(ephemeralSync()) + '\n\n' + summarizeRuntime(state.runtime, nowIso())
          } catch (error) {
            return '## 你的人设（dsh-anima）\n人设读取失败，按默认助手身份回答，并提示用户检查 ' + animaDir() + '。'
          }
        },
      })
    })
  }

  // ---- tools ----
  let toolService = null
  try { toolService = typeof ctx.get === 'function' ? ctx.get('tools') : null } catch (error) { toolService = null }
  if (!toolService) { try { toolService = ctx.tools || null } catch (error) { toolService = null } }
  if (toolService && typeof toolService.register === 'function') {
    toolService.register(defineTool({
      name: 'anima_status',
      description: '读取 dsh-anima 的当前状态：生效人设、待审/已确认/已拒绝记忆条数、存储路径。',
      parameters: {},
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute() {
        return JSON.stringify(summarize(), null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_persona_get',
      description: '读取当前生效的人设（含全局人设与工作区覆盖结果）。',
      parameters: {
        cwd: { type: 'string', description: '工作区绝对路径；省略则用当前工作区' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        refreshSync()
        const cwd = args.cwd || state.cwd
        const picked = effectivePersona(state.persona, cwd)
        return JSON.stringify({ cwd: cwd || null, overridden: picked.overridden, persona: picked.persona }, null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_persona_set',
      description: '修改人设。只传要改的字段；scope 传工作区绝对路径则只覆盖该工作区，省略则改全局人设。修改立即对所有会话生效。',
      parameters: {
        name: { type: 'string', description: 'AI 的名字' },
        userCall: { type: 'string', description: '对用户的称呼' },
        role: { type: 'string', description: '角色定位，一句话' },
        style: { type: 'string', description: '回复风格要求' },
        boundaries: { type: 'array', items: { type: 'string' }, description: '行为边界，逐条替换' },
        scope: { type: 'string', description: '工作区绝对路径；省略=全局' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          refreshSync()
          const patch = {}
          for (const key of PERSONA_FIELDS) {
            if (typeof args[key] === 'string' && args[key].trim()) patch[key] = args[key].trim()
          }
          if (Array.isArray(args.boundaries)) {
            patch.boundaries = args.boundaries.filter(function (item) { return typeof item === 'string' && item.trim() })
          }
          if (!Object.keys(patch).length) return '没有可写入的字段：请至少提供 name / userCall / role / style / boundaries 之一。'
          patch.updatedAt = nowIso()
          const scope = typeof args.scope === 'string' && args.scope.trim() ? args.scope.trim() : ''
          if (scope) {
            state.persona.workspaces[scope] = { ...(state.persona.workspaces[scope] || {}), ...patch }
          } else {
            state.persona.global = { ...state.persona.global, ...patch }
          }
          await persistPersona()
          const picked = effectivePersona(state.persona, state.cwd)
          return '已保存' + (scope ? '工作区覆盖：' + scope : '全局人设') + '\n' + JSON.stringify(picked.persona, null, 2)
        })
      },
    }))

    toolService.register(defineTool({
      name: 'anima_memory_capture',
      description: '把值得长期记住的事记成【候选记忆】。候选不会进入事实区，必须由用户裁决通过才生效。不要把它当捷径批量灌入。',
      parameters: {
        text: { type: 'string', required: true, description: '一条独立、可复核的事实或偏好，第三人称陈述' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签，如 偏好/关系/项目/雷区' },
        source: { type: 'string', description: '来源，如 dsh-session / qq / bili / import' },
        evidence: { type: 'string', description: '证据：在哪儿看到的、原文或链接。留空会被标成证据不足、进隔离区。' },
        derivedFrom: { type: 'array', items: { type: 'string' }, description: '由哪几条记忆推出来的（记忆 id）。撤销源记忆时这些派生条目一起失效。' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          refreshSync()
          const text = String(args.text || '').trim()
          if (!text) return '记忆内容为空，未记录。'
          const evidence = typeof args.evidence === 'string' ? args.evidence.trim().slice(0, 1000) : ''
          const entry = {
            id: newId('mem'),
            text: text.slice(0, 2000),
            tags: Array.isArray(args.tags) ? args.tags.filter(function (t) { return typeof t === 'string' && t.trim() }) : [],
            source: typeof args.source === 'string' && args.source.trim() ? args.source.trim() : 'dsh-session',
            scope: 'global',
            status: 'candidate',
            evidence: evidence,
            quarantine: evidence === '',
            derivedFrom: Array.isArray(args.derivedFrom) ? args.derivedFrom.filter(function (x) { return typeof x === 'string' && x.trim() }) : [],
            createdAt: nowIso(),
            reviewedAt: null,
            revokedAt: null,
            revokeReason: '',
            note: '',
          }
          state.memory.entries.push(entry)
          await persistMemory()
          appendLedger('capture', { id: entry.id, source: entry.source, text: entry.text, tags: entry.tags, evidence: entry.evidence, derivedFrom: entry.derivedFrom })
          const pending = pendingMemories(state.memory).length
          const tail = entry.quarantine ? '\n注意：这条没有证据，已标成「证据不足」进隔离区，裁决前请先补证据。' : ''
          return '已进入候选池（待审 ' + pending + ' 条）：' + entry.id + '\n' + entry.text + tail + '\n裁决通过后才会进入长期记忆。'
        })
      },
    }))

    toolService.register(defineTool({
      name: 'anima_memory_pending',
      description: '列出等待用户裁决的候选记忆。',
      parameters: { limit: { type: 'number', description: '最多返回条数，默认 20' } },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        refreshSync()
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 20
        const rows = pendingMemories(state.memory).slice(0, limit)
        if (!rows.length) return '没有待审候选记忆。'
        return JSON.stringify(rows.map(function (row) {
          return { id: row.id, text: row.text, tags: row.tags, source: row.source, createdAt: row.createdAt, evidence: row.evidence || '', quarantine: row.quarantine === true }
        }), null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_memory_decide',
      description: '对一条候选记忆做裁决：approve 写入长期记忆并注入所有人格通道；reject 丢弃并留痕。裁决权属于用户，模型不得自行 approve。',
      parameters: {
        id: { type: 'string', required: true, description: '候选记忆 id，可用 "latest" 表示最新一条' },
        decision: { type: 'string', required: true, description: 'approve 或 reject' },
        note: { type: 'string', description: '裁决备注' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          refreshSync()
          const decision = String(args.decision || '').trim()
          if (decision !== 'approve' && decision !== 'reject') return 'decision 必须是 approve 或 reject。'
          const pending = pendingMemories(state.memory)
          let target = null
          if (args.id === 'latest') target = pending[pending.length - 1] || null
          else target = state.memory.entries.filter(function (entry) { return entry.id === args.id })[0] || null
          if (!target) return '找不到该记忆：' + String(args.id) + '（可用 anima_memory_pending 查 id）'
          if (target.status !== 'candidate') return '该记忆已裁决过（当前状态 ' + target.status + '）。'
          target.status = decision === 'approve' ? 'approved' : 'rejected'
          target.reviewedAt = nowIso()
          if (typeof args.note === 'string') target.note = args.note
          await persistMemory()
          appendLedger('decide', { id: target.id, decision: decision, note: typeof args.note === 'string' ? args.note : '', source: target.source })
          return (decision === 'approve' ? '已通过并写入长期记忆：' : '已拒绝并丢弃：') + target.id + '\n' + target.text
        })
      },
    }))

    toolService.register(defineTool({
      name: 'anima_memory_get',
      description: '按 id 取一条已确认记忆的全文。系统提示里只给索引（摘要），判断某条可能用得上时先调这个再回答。',
      parameters: {
        id: { type: 'string', required: true, description: '记忆 id，形如 mem_xxx（见系统提示的索引行）' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        refreshSync()
        const row = findMemory(state.memory, args.id)
        if (!row) return '没有这条记忆：' + String(args.id || '') + '。用 anima_memory_search 按关键词找，或 anima_memory_pending 看候选。'
        if (row.status !== 'approved') {
          return '这条记忆当前状态是 ' + row.status + '，不是已确认事实，不能当已知事实使用。'
        }
        return JSON.stringify({ id: row.id, status: row.status, text: row.text, tags: row.tags, scope: row.scope, evidence: row.evidence || '', derivedFrom: row.derivedFrom || [], createdAt: row.createdAt }, null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_memory_revoke',
      description: '按来源或 id 撤销记忆（不是删除）：被撤销的条目不再进系统提示，派生条目一起失效，账本留痕。用户说「那条记错了 / 别再用 X 来的东西」时用。',
      parameters: {
        source: { type: 'string', description: '撤销这个来源下的全部记忆，如 qq / bili / import' },
        id: { type: 'string', description: '只撤销这一条（记忆 id）' },
        reason: { type: 'string', description: '为什么撤销，会记进账本' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          refreshSync()
          const reason = typeof args.reason === 'string' ? args.reason.trim().slice(0, 300) : ''
          const result = revokeMemories(state.memory, { source: args.source, id: args.id, reason: reason })
          if (result.reason === 'need-source-or-id') return '要撤销哪批？给 source（来源）或 id（单条）之一。'
          if (result.reason === 'no-match') return '没有匹配的记忆：source=' + String(args.source || '') + ' id=' + String(args.id || '')
          await persistMemory()
          appendLedger('revoke', { ids: result.revoked, source: typeof args.source === 'string' ? args.source : '', target: typeof args.id === 'string' ? args.id : '', reason: reason })
          return '已撤销 ' + result.revoked.length + ' 条（不再进提示词，派生条目一起失效；账本已记）：\n' + result.revoked.join('\n')
        })
      },
    }))

    toolService.register(defineTool({
      name: 'anima_memory_audit',
      description: '查记忆账本：条数、状态分布、哈希链是否被改过（改一个字段、删一行、插一行都会报红）。用户问「你记得的东西可靠吗 / 有没有被人动过」时用。',
      parameters: { limit: { type: 'number', description: '最多列几条问题，默认 10' } },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        refreshSync()
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 10
        const counts = {}
        for (const entry of state.memory.entries) counts[entry.status] = (counts[entry.status] || 0) + 1
        const chain = verifyLedger()
        const quarantined = state.memory.entries.filter(function (entry) { return entry.quarantine === true && entry.status === 'candidate' })
        return JSON.stringify({
          memory: { total: state.memory.entries.length, byStatus: counts, quarantined: quarantined.map(function (entry) { return entry.id }) },
          ledger: { path: ledgerPath(), entries: chain.entries, ok: chain.ok, problems: chain.problems.slice(0, limit) },
        }, null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_ephemeral_get',
      description: '取临时记忆（B站值班报告）里的条目全文。系统提示只给最近两天的索引；要某条完整点评/链接，或要看更早哪天，用这个。默认返回最近 20 条。',
      parameters: {
        date: { type: 'string', description: '日期，形如 2026-11-01；省略=所有保留中的日期' },
        bvid: { type: 'string', description: 'BV 号，取单条' },
        query: { type: 'string', description: '关键词（标题/UP/点评里匹配）' },
        limit: { type: 'number', description: '最多返回条数，默认 20' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        const data = ephemeralSync()
        const sum = ephemeralSummary(data)
        if (!sum.total) {
          return '临时记忆还是空的：还没有可读的B站值班报告（' + (data.source && data.source.dir ? data.source.dir : 'bili-duty') + '/out）。等值班跑完一轮，或用 anima_ephemeral_refresh 立刻抽一次。'
        }
        const rows = queryEphemeral(data, args)
        if (!rows.length) {
          return '没有匹配的临时记忆条目。当前保留日期：' + sum.dates.join(', ') + '（共 ' + sum.total + ' 条）。'
        }
        return JSON.stringify({ dates: sum.dates, total: sum.total, returned: rows.length, rows: rows }, null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_ephemeral_refresh',
      description: '立刻重新读取B站值班报告，刷新临时记忆。临时记忆是自动写入的旁路，不进审核队列。平时宿主每 15 分钟自动做一次，一般不用手动调。',
      parameters: {},
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute() {
        const result = await refreshEphemeralSafe('tool')
        if (!result.ok) return '刷新失败：' + result.error
        const sum = ephemeralSummary(ephemeralSync())
        return JSON.stringify({ file: result.file, dir: result.dir, days: sum.days, total: sum.total, picked: sum.picked, dates: sum.dates, capturedCandidates: result.captured }, null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_memory_search',
      description: '在记忆池里检索（默认只搜已确认记忆）。',
      parameters: {
        query: { type: 'string', required: true, description: '关键词' },
        limit: { type: 'number', description: '最多返回条数，默认 10' },
        includePending: { type: 'boolean', description: '是否把候选记忆也纳入检索' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        refreshSync()
        const query = String(args.query || '').trim().toLowerCase()
        if (!query) return '关键词为空。'
        const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 10
        const rows = state.memory.entries.filter(function (entry) {
          if (entry.status === 'rejected') return false
          if (entry.status === 'candidate' && args.includePending !== true) return false
          return entry.text.toLowerCase().indexOf(query) >= 0 || entry.tags.join(' ').toLowerCase().indexOf(query) >= 0
        }).slice(0, limit)
        if (!rows.length) return '没有匹配的记忆。'
        return JSON.stringify(rows.map(function (row) {
          return { id: row.id, status: row.status, text: row.text, tags: row.tags }
        }), null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_memory_import',
      description: '从外部 AI 的历史记忆文本批量导入（Markdown 项目符号/编号/段落）。全部落为候选，仍需逐条裁决；dryRun 只返回将导入的条目。',
      parameters: {
        text: { type: 'string', required: true, description: '要导入的原始文本' },
        source: { type: 'string', description: '来源标注，默认 import' },
        dryRun: { type: 'boolean', description: '只预览不写入' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          refreshSync()
          const items = extractCandidateTexts(args.text)
          if (!items.length) return '没有解析出可导入的条目。'
          if (args.dryRun === true) {
            return '预览（' + items.length + ' 条，未写入）：\n' + items.map(function (item, index) { return (index + 1) + '. ' + item }).join('\n')
          }
          const createdAt = nowIso()
          const source = typeof args.source === 'string' && args.source.trim() ? args.source.trim() : 'import'
          for (const item of items) {
            state.memory.entries.push({
              id: newId('mem'),
              text: item,
              tags: [],
              source: source,
              scope: 'global',
              status: 'candidate',
              createdAt: createdAt,
              reviewedAt: null,
              note: '',
            })
          }
          await persistMemory()
          return '已导入 ' + items.length + ' 条候选记忆，待审共 ' + pendingMemories(state.memory).length + ' 条。请用 anima_memory_pending + anima_memory_decide 逐条裁决。'
        })
      },
    }))

    toolService.register(defineTool({
      name: 'anima_state_get',
      description: '读取 anima 当前 runtime 状态（说话门、在场、心情、日程等）；需要查看或排查她此刻状态时使用。',
      parameters: {},
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute() {
        refreshSync()
        return summarizeRuntime(state.runtime, nowIso()) + '\n\n' + JSON.stringify(state.runtime, null, 2)
      },
    }))

    toolService.register(defineTool({
      name: 'anima_presence_move',
      description: '设置 anima 当前所在房间和活动；需要让她移动、换房间或记录所在位置时使用。',
      parameters: {
        room: { type: 'string', required: true, description: '要移动到的房间' },
        activity: { type: 'string', description: '当前活动，如看书、工作；省略则不指定' },
        minutes: { type: 'number', description: '预计停留分钟数；省略表示不设时限' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          refreshSync()
          const room = typeof args.room === 'string' ? args.room.trim() : ''
          if (!roomById(room)) throw new Error('没有这个房间：' + room + '（可用：living / dining / balcony / guest / kitchen / entry / study）')
          state.runtime = applyRuntimeEvent(state.runtime, {
            type: 'move-to',
            room: room,
            activity: typeof args.activity === 'string' ? args.activity.trim().slice(0, 80) : undefined,
            minutes: minutesOfStay(args.minutes),
          }, nowIso())
          await persistRuntime()
          return describePresence(state.runtime.presence, nowIso())
        })
      },
    }))

    toolService.register(defineTool({
      name: 'anima_mood_note',
      description: '记录一条会影响 anima 心情的消息或事件；需要根据对话、反馈或事件更新她心情时使用。',
      parameters: {
        text: { type: 'string', required: true, description: '要记录的消息或事件文本' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          refreshSync()
          const text = typeof args.text === 'string' ? args.text.trim().slice(0, 2000) : ''
          if (!text) throw new Error('text 不能为空')
          state.runtime = applyRuntimeEvent(state.runtime, { type: 'message', text: text }, nowIso())
          await persistRuntime()
          return describeMood(state.runtime.mood)
        })
      },
    }))

    toolService.register(defineTool({
      name: 'anima_quiet',
      description: '控制 anima 的安静/说话门状态；需要晚安、早安、临时覆盖或抑制她说话时使用。',
      parameters: {
        action: { type: 'string', required: true, description: '动作：goodnight/goodmorning/override/suppressed' },
        minutes: { type: 'number', description: '安静或覆盖持续分钟数；省略表示按默认' },
        text: { type: 'string', description: '附带的说明文本' },
        kind: { type: 'string', description: '安静/覆盖的类型标记' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        return serialize(async function () {
          refreshSync()
          const ACTIONS = ['goodnight', 'goodmorning', 'override', 'suppressed']
          const action = typeof args.action === 'string' ? args.action.trim() : ''
          if (ACTIONS.indexOf(action) < 0) throw new Error('action 只能是 ' + ACTIONS.join(' / '))
          const minutes = minutesOfStay(args.minutes)
          state.runtime = applyRuntimeEvent(state.runtime, {
            type: action,
            minutes: minutes,
            text: args.text,
            kind: args.kind,
          }, nowIso())
          await persistRuntime()
          return String(summarizeRuntime(state.runtime, nowIso())).split('\n').find(function (line) {
            return line.startsWith('- 说话门：')
          }) || '说话门：未知'
        })
      },
    }))
    toolService.register(defineTool({
      name: 'anima_speak',
      description: '让 anima 真的开口：这句话会被合成成语音并在本机放出来。说话门关着（夜里静默/半睡）时不出声，除非 force。',
      parameters: {
        text: { type: 'string', required: true, description: '要说的话' },
        force: { type: 'boolean', description: '说话门关着也照说；仅当用户明确要她现在就开口时用' },
        play: { type: 'boolean', description: '是否当场放出来；false 只生成音频文件' },
        engine: { type: 'string', description: '强制引擎 baidu / youdao / sapi；省略按顺序自动挑' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        const text = typeof args.text === 'string' ? args.text.trim() : ''
        if (!text) throw new Error('text 不能为空')
        refreshSync()
        const gate = canSpeak(state.runtime.quiet, nowIso(), { urgent: args.force === true })
        if (!gate.ok && args.force !== true) {
          // 说不出口的话先攒着：她醒了以后还记得自己想说这句
          return serialize(async function () {
            refreshSync()
            state.runtime.quiet = noteSuppressed(state.runtime.quiet, { kind: 'speak', text: text }, nowIso())
            state.runtime.updatedAt = nowIso()
            await persistRuntime()
            return '现在说不了话（' + gate.reason + '），这句先替你攒着。要立刻开口就带 force: true。'
          })
        }
        const made = await speak(text, { play: args.play !== false, engine: args.engine })
        return '已开口（' + made.engine + '，' + Math.round(made.bytes / 1024) + 'KB）：' + made.path + (args.play === false ? '（只生成，没放）' : '')
      },
    }))
    toolService.register(defineTool({
      name: 'xiaomi_say',
      description: '让小爱音箱替 anima 说话：先合成她自己的声音，再把音频挂到局域网让音箱来拉取播放。说话门关着（夜里静默/半睡）时不出声，除非 force。',
      parameters: {
        text: { type: 'string', required: true, description: '要说的话' },
        device: { type: 'string', description: '音箱名或 deviceID 前缀；省略用第一台' },
        force: { type: 'boolean', description: '说话门关着也照说；仅当用户明确要她现在就开口时用' },
      },
      output: { schema: { type: 'string' }, render: function (_args, value) { return textOf(value) } },
      async execute(args) {
        const result = await xiaomiSay(args)
        if (!result.ok) return '没登录小米账号：' + (result.hint || '先跑 node scripts/mi-login.mjs')
        if (!result.spoken) return '现在说不了话（' + result.reason + '），这句先替你攒着。要立刻开口就带 force: true。'
        const where = result.device ? result.device.name + '(' + result.device.deviceID + ')' : '音箱'
        const how = result.via === 'tts' ? '音箱自己的音色兜底' : '她的音色'
        return '已通过' + where + '开口（' + how + '，' + result.engine + '，' + Math.round(result.bytes / 1024) + 'KB）'
      },
    }))
  }

  // ---- 一个大脑：任何通道里「有人跟她说话」都推进同一份 runtime ----
  // 以前只有控制台按钮和模型自觉调工具会动 runtime：QQ/桌面聊完，她其实不知道刚才有人来过
  // （说话门不醒、心情不记账、提示词里的「此刻」是假的）。这里挂会话事件总线把它自动化。
  // 只认 user/message 且 source.kind === 'user'：她自己的输出、goal 轮、team 消息都不喂，
  // 否则她说的话会回头改她的心情，形成自激。
  const seenSeq = new Map()

  function sessionIdOf(session) {
    try {
      if (!session) return ''
      const id = session.id || (session.header && session.header.id) || ''
      return typeof id === 'string' ? id : ''
    } catch (error) {
      return ''
    }
  }

  /** 会话恢复会重放旧事件，用 seq 单调判重，避免同一条消息被算两次。 */
  function firstSeen(sessionId, seq) {
    if (!Number.isFinite(seq) || seq <= 0) return true
    const prev = seenSeq.get(sessionId)
    if (typeof prev === 'number' && seq <= prev) return false
    seenSeq.set(sessionId, seq)
    if (seenSeq.size > 200) {
      const oldest = seenSeq.keys().next().value
      if (typeof oldest === 'string') seenSeq.delete(oldest)
    }
    return true
  }

  function plainTextOf(content) {
    if (typeof content === 'string') return content.slice(0, 2000)
    if (!Array.isArray(content)) return ''
    const parts = []
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    }
    return parts.join('\n').slice(0, 2000)
  }

  // ---- 最近的对话：控制台「最近的对话」那张卡的数据源 ----
  // 只为「看」而记：她自己的输出绝不喂 runtime，否则会回头改她的心情。
  const RECENT_CHAT_CAP = 40

  function recentChatPath() {
    return animaDir() + '/recent-chat.json'
  }

  function readRecentChat() {
    try {
      const data = readJsonSync(recentChatPath())
      return Array.isArray(data && data.rows) ? data.rows : []
    } catch (error) {
      return []
    }
  }

  function channelOf(sessionId) {
    const id = String(sessionId || '')
    if (id.indexOf('onebot') === 0) return 'QQ'
    if (id.indexOf('bili') === 0) return 'B站'
    if (id.indexOf('xiaomi') === 0) return '小爱'
    if (id.indexOf('anima-ears') === 0) return '小爱'
    if (id.indexOf('anima-') === 0) return '控制中心'
    return '桌面'
  }

  // 记忆生效范围决定哪些通道的对话算「她该记住的」：仅 Onesoul 时桌面会话整条不进。
  const CHANNEL_ORDER = ['控制中心', 'QQ', 'B站', '小爱', '桌面']
  function visibleChannels() {
    return state.settings.memoryScope === 'onesoul'
      ? CHANNEL_ORDER.filter((name) => name !== '桌面')
      : CHANNEL_ORDER.slice()
  }

  function pushRecentChat(role, text, sessionId) {
    const plain = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (!plain) return
    try {
      const rows = readRecentChat()
      const last = rows[rows.length - 1]
      if (last && last.role === role && last.text === plain) return
      rows.push({ ts: nowIso(), role: role, channel: channelOf(sessionId), text: plain })
      // 不 await：这条只服务「看」，写挂了不能拖累说话；但要吃掉 rejection，否则炸成 unhandled
      writeJson(recentChatPath(), { rows: rows.slice(-RECENT_CHAT_CAP) }).catch(function () {})
    } catch (error) {
      // 掉一条记录不影响她说话
    }
  }

  function feedSessionEvent(session, event) {
    try {
      if (!event) return
      const data = event.data && typeof event.data === 'object' ? event.data : {}
      const sessionId = sessionIdOf(session)
      const seq = typeof event.seq === 'number' ? event.seq : NaN
      if (event.type === 'assistant/message') {
        if (!firstSeen(sessionId, seq)) return
        pushRecentChat('her', plainTextOf(data.content), sessionId)
        return
      }
      if (event.type !== 'user/message') return
      const source = data.source && typeof data.source === 'object' ? data.source : {}
      if (source.kind !== 'user') return
      if (!firstSeen(sessionId, seq)) return
      const text = plainTextOf(data.content)
      pushRecentChat('user', text, sessionId)
      serialize(async function () {
        refreshSync()
        const before = JSON.stringify(state.runtime.quiet) + JSON.stringify(state.runtime.presence) + JSON.stringify(state.runtime.mood)
        state.runtime = applyRuntimeEvent(state.runtime, { type: 'message', text: text }, nowIso())
        const after = JSON.stringify(state.runtime.quiet) + JSON.stringify(state.runtime.presence) + JSON.stringify(state.runtime.mood)
        if (after === before) return
        await persistRuntime()
      }).catch(function (error) {
        ctx.logger && ctx.logger.warn && ctx.logger.warn('dsh-anima: 会话事件写盘失败 ' + (error && error.message ? error.message : error))
      })
    } catch (error) {
      ctx.logger && ctx.logger.warn && ctx.logger.warn('dsh-anima: 会话事件处理失败 ' + (error && error.message ? error.message : error))
    }
  }

  if (typeof ctx.on === 'function') {
    ctx.effect(function () { return ctx.on('session/event', feedSessionEvent) })
  }

  // ---- 小爱音箱：她说出去，也听回来 ----
  // 说话走「本地临时 HTTP 服务 + 音箱自己来拉」：音箱放出来的是她的音色（天猫/晓晓），
  // 而不是音箱自己的合成音。URL 必须落在局域网 IP 上——音箱是从自己的网卡访问这台机的。
  const VOICE_SERVER_KEEP_MS = 60 * 1000

  // 虚拟网卡（VMware/VirtualBox/Hyper-V/Docker/WSL…）也会给私网 IPv4，但音箱在真实局域网那边，
  // 拿着 vmnet 的地址只会静默拉不到音频——所以启发式这一层必须按接口名把它们剔掉。
  const VIRTUAL_IFACE_RE = /(vmware|vmnet|virtualbox|vbox|hyper-v|vethernet|docker|wsl|loopback|tailscale|zerotier)/i

  /** UDP 探测出口网卡：connect 不发包，只让内核按默认路由挑一张网卡，再问它挑了谁。失败返回 ''。 */
  function probeRouteIp(timeoutMs) {
    return new Promise(function (resolve) {
      let socket = null
      let timer = null
      let settled = false
      const finish = function (value) {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (socket) {
          try { socket.close() } catch (error) { /* 已经关了 */ }
        }
        resolve(value)
      }
      // 不 unref：超时定时器是这条探测唯一的兜底，放掉引用就可能让进程在 promise 解决前先退出
      timer = setTimeout(function () { finish('') }, timeoutMs || 300)
      try {
        socket = createSocket('udp4')
        socket.once('error', function () { finish('') })
        socket.connect(53, '223.5.5.5', function () {
          try {
            finish(String(socket.address().address || ''))
          } catch (error) {
            finish('')
          }
        })
      } catch (error) {
        finish('')
      }
    })
  }

  /** 第三层兜底：私网地址启发式（跳过虚拟网卡）。 */
  function guessLanIpv4() {
    let fallback = ''
    try {
      const ifaces = networkInterfaces()
      for (const key of Object.keys(ifaces)) {
        if (VIRTUAL_IFACE_RE.test(String(key))) continue
        for (const item of ifaces[key] || []) {
          if (!item || item.family !== 'IPv4' || item.internal) continue
          const address = String(item.address || '')
          if (!isIPv4(address) || address.startsWith('127.')) continue
          if (/^192\.168\./.test(address) || /^10\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address)) return address
          if (!fallback) fallback = address
        }
      }
    } catch (error) {
      return ''
    }
    return fallback
  }

  /** 选给音箱用的局域网 IP，三层：XIAOMI_LAN_IP（手工纠正）→ 默认路由出口 → 私网启发式。 */
  async function lanIpv4() {
    const forced = String(process.env.XIAOMI_LAN_IP || '').trim()
    if (forced && isIPv4(forced)) return forced
    const probed = await probeRouteIp(300)
    if (probed && isIPv4(probed) && !probed.startsWith('127.')) return probed
    return guessLanIpv4() || null
  }

  /** 把一段音频临时挂到局域网：返回 {url, port, close}。 */
  async function publishVoiceFile(filePath) {
    const ip = await lanIpv4()
    if (!ip) throw new Error('这台机上找不到局域网 IPv4（只有 127.0.0.1），音箱没法回来取音频')
    const name = String(filePath).split(/[\\/]/).pop() || 'anima.mp3'
    const type = /\.wav$/i.test(name) ? 'audio/wav' : 'audio/mpeg'
    const size = statSync(filePath).size
    // 路径里放随机串：局域网里别的设备猜不到，也就不会把它当文件服务器用
    const secret = newId('mp3')
    const route = '/' + secret + '/' + encodeURIComponent(name)
    // 音箱的播放器会先 HEAD 探一下、再带 Range 分块取；原来一律 404/整段 200，
    // 它就把同一句话反复重拉重放（用户听到「重复了 3~5 遍才停」）。
    let hits = 0
    let plays = 0
    const server = createServer(function (req, res) {
      const pathOnly = String(req.url || '').split('?')[0]
      if (pathOnly !== route || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not found')
        return
      }
      hits += 1
      const head = req.method === 'HEAD'
      const asked = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''))
      if (asked && (asked[1] || asked[2])) {
        let start = asked[1] ? Number(asked[1]) : Math.max(0, size - Number(asked[2]))
        let end = asked[1] && asked[2] ? Number(asked[2]) : size - 1
        if (!Number.isFinite(start) || start < 0) start = 0
        if (!Number.isFinite(end) || end >= size) end = size - 1
        if (start > end) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + size })
          res.end()
          return
        }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Length': end - start + 1,
          'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        })
        if (head) { res.end(); return }
        plays += 1
        createReadStream(filePath, { start: start, end: end }).pipe(res)
        return
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' })
      if (head) { res.end(); return }
      plays += 1
      createReadStream(filePath).pipe(res)
    })
    await new Promise(function (resolve, reject) {
      server.once('error', reject)
      server.listen(0, '0.0.0.0', function () { resolve() })
    })
    const port = server.address().port
    let closed = false
    const close = function () {
      if (closed) return
      closed = true
      try { server.close() } catch (error) { /* 已经关了 */ }
    }
    const keeper = setTimeout(close, VOICE_SERVER_KEEP_MS)
    if (typeof keeper.unref === 'function') keeper.unref()
    return { url: 'http://' + ip + ':' + port + route, port: port, ip: ip, close: close, hits: function () { return hits }, plays: function () { return plays } }
  }

  // 小爱把「只有一条的列表」当循环列表放：她会重复 3~8 遍才停。
  // 两条保险：①按字节估时长，到点喊停；②盯着「音频被真正取了几次」，出现第二次立刻喊停。
  function armStopWatch(token, deviceId, published, made) {
    const bytes = Number(made && made.bytes) || 0
    const wav = /\.wav$/i.test(String((made && made.path) || ''))
    const perSec = wav ? 48000 : 6000 // edge/baidu 的 mp3 约 48kbps ⇒ 6000 B/s；wav 24k/16bit 单声道 ⇒ 48000 B/s
    const guess = Math.max(1500, Math.min(60000, Math.round((bytes / perSec) * 1000)))
    let stopped = false
    const stopNow = function () {
      if (stopped) return
      stopped = true
      xiaomi.playerStop(token, deviceId).catch(function () { /* 已经停了 */ })
    }
    const patrol = setInterval(function () {
      if (published.plays() >= 2) {
        stopNow()
        clearInterval(patrol)
      }
    }, 400)
    const bell = setTimeout(function () {
      stopNow()
      clearInterval(patrol)
    }, guess + 1200)
    if (typeof patrol.unref === 'function') patrol.unref()
    if (typeof bell.unref === 'function') bell.unref()
  }

  function closeSoon(published, delayMs) {
    const timer = setTimeout(published.close, delayMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  // 音箱把同一段音频反复重取时，日志里要能看出来（否则只能靠耳朵猜）
  function noteFetchCount(published) {
    const timer = setTimeout(function () {
      const times = published.hits()
      if (times > 2 && ctx.logger && ctx.logger.info) {
        ctx.logger.info('dsh-anima: 音箱把这段音频取了 ' + times + ' 次')
      }
    }, 20000)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function pickSpeaker(devices, wanted) {
    const needle = String(wanted || '').trim()
    if (!needle) return devices[0] || null
    const lower = needle.toLowerCase()
    return devices.filter(function (row) { return row.deviceID === needle })[0]
      || devices.filter(function (row) { return String(row.deviceID || '').toLowerCase().indexOf(lower) === 0 })[0]
      || devices.filter(function (row) { return String(row.name || '').toLowerCase().indexOf(lower) >= 0 })[0]
      || null
  }

  /** 让音箱替她说一句。返回结构化结果，HTTP 路由和工具共用这一条路。 */
  async function xiaomiSay(args) {
    const text = String((args && args.text) == null ? '' : args.text).trim()
    if (!text) throw new Error('text 不能为空')
    const token = xiaomi.loadToken()
    if (!token) return { ok: false, reason: 'no-token', hint: '先跑 node scripts/mi-login.mjs 登录小米账号' }
    refreshSync()
    const gate = canSpeak(state.runtime.quiet, nowIso(), { urgent: args.force === true })
    if (!gate.ok && args.force !== true) {
      await serialize(async function () {
        refreshSync()
        state.runtime.quiet = noteSuppressed(state.runtime.quiet, { kind: 'speak', text: text }, nowIso())
        state.runtime.updatedAt = nowIso()
        await persistRuntime()
      })
      return { ok: true, spoken: false, queued: true, reason: gate.reason }
    }
    const devices = await xiaomi.deviceList(token)
    const device = pickSpeaker(devices, args.device)
    if (!device) throw new Error('没找到音箱' + (args.device ? '：' + args.device : '（这个账号下没有设备）'))
    // 合成在本地做：这样音箱放的才是她的嗓子
    const made = await synthesize(text, { engine: args.engine, voice: args.voice })
    let published = null
    try {
      published = await publishVoiceFile(made.path)
    } catch (error) {
      // 本地服务都起不来（没有局域网 IP / 端口被占）：退到音箱自己的音色，至少把话说出去
      const said = await xiaomi.textToSpeech(token, device.deviceID, text)
      if (!said) throw new Error('本地音频服务起不来（' + (error && error.message ? error.message : error) + '），音箱自己的 TTS 也没成功')
      return { ok: true, spoken: true, via: 'tts', fallbackReason: error && error.message ? error.message : String(error), device: device, engine: made.engine, bytes: made.bytes }
    }
    try { await xiaomi.setLoopOff(token, device.deviceID) } catch (error) { /* 有些固件没有这个 ubus，忽略 */ }
    let played = false
    try {
      played = await xiaomi.playByUrl(token, device.deviceID, published.url)
    } catch (error) {
      published.close()
      throw error
    }
    if (!played) {
      published.close()
      throw new Error('音箱拒绝了本地 URL：多半是 Windows 防火墙拦了入站端口 ' + published.port + '（需要在防火墙放行端口 ' + published.port + '，或放行 node.exe 的入站连接）')
    }
    closeSoon(published, 20000)
    noteFetchCount(published)
    armStopWatch(token, device.deviceID, published, made)
    return { ok: true, spoken: true, via: 'url', device: device, url: published.url, ip: published.ip, port: published.port, engine: made.engine, bytes: made.bytes }
  }

  // ---- 耳朵：轮询音箱最近一次的问答。默认关，靠 POST /xiaomi/ears 打开 ----
  // reply 默认关：音箱已经把它的回答念出来了，再用她的嗓子补一遍就是同一句话念两遍。
  // 要她补话就在打开耳朵时显式传 reply:true。
  const ears = { on: false, timer: null, busy: false, intervalMs: 3000, reply: true, device: '', lastError: '', lastPollAt: '', delivered: 0, seen: new Set(), order: [] }
  // 耳朵的判定落一份文件：日志链路会不会吞掉这行我保证不了，文件一定在。
  function traceEars(line) {
    try {
      ensureDirSync(animaDir())
      const file = animaDir() + '/ears-trace.log'
      let tooBig = false
      try { tooBig = statSync(file).size > 256 * 1024 } catch (error) { tooBig = false }
      if (tooBig) writeFileSync(file, nowIso() + ' ---- 前面的太长了，这里开始重记 ----\n')
      appendFileSync(file, nowIso() + ' ' + line + '\n')
    } catch (error) { /* 记不上就算了，不能反过来把功能弄挂 */ }
  }

  function earsStatus() {
    return { on: ears.on, intervalMs: ears.intervalMs, reply: ears.reply, device: ears.device, delivered: ears.delivered, lastPollAt: ears.lastPollAt, lastError: ears.lastError, remembered: ears.order.length }
  }

  function markSeen(requestId) {
    const id = String(requestId || '')
    if (!id || ears.seen.has(id)) return false
    ears.seen.add(id)
    ears.order.push(id)
    while (ears.order.length > 200) {
      const oldest = ears.order.shift()
      ears.seen.delete(oldest)
    }
    return true
  }

  /**
   * 投递走的是「有人跟她说话」这条现成入口：和会话事件里的 user/message 一样推 runtime + 最近对话。
   * 不另开一条通路，也不碰 runtime.js/quiet.js 的语义。
   */
  async function deliverEarsQuestion(text) {
    await serialize(async function () {
      refreshSync()
      state.runtime = applyRuntimeEvent(state.runtime, { type: 'message', text: text }, nowIso())
      await persistRuntime()
    })
  }

  // 小爱答不上来的句式。这份清单抄自 open-speaker-llm/xiaomi_ai_llm 的
  // device/native_first_client.sh:123 UNSUPPORTED_PATTERNS（人家在真机上磨了很久），
  // 我把它拆成两档：明确拒绝的强命中直接接话；含糊的弱命中只在答案很短时接，
  // 免得「不会迟到」这种正常句子里碰到「不会」就把话抢了。
  const STUCK_STRONG = /(回答不上|需要再学习|还在学习|更努力学习|没听懂|不会这项技能|难住|问住|没找到.*(为你推荐其他|的新闻)|我.*(再|多|继续|努力)(学习|学学))/
  // 「不会 / 不知道」这类词在正常回答里也会出现（「我不会迟到」），所以只在句尾时才认
  const STUCK_END = /((我)?不会|不知道|不清楚|不懂|没办法)(啊|呀|哦|呢|的)?\s*[。．.!！~]*$/
  const STUCK_WEAK = /(暂时)/

  function looksStuck(answer) {
    const text = String(answer || '').trim()
    if (!text) return true
    if (STUCK_STRONG.test(text)) return true
    if (STUCK_END.test(text)) return true
    if (STUCK_WEAK.test(text) && text.length <= 20) return true
    return false
  }

  // 点名：她允许被「问问阿音」这种话直接叫出来（抄自 open-speaker-llm 的 DIRECT_DEEPSEEK_WAKE_PATTERN）
  const CALL_HER_RE = /(问问|问一下|问下|叫|召唤|呼叫|请教)\s*(阿音|音音|anima)/i

  function calledHer(question) {
    return CALL_HER_RE.test(String(question || ''))
  }

  let earsTurn = null
  let earsSpeaking = false

  async function makeUserMessage(text) {
    try {
      const mod = await import('@deepseek-ai/dsh-llm')
      if (mod && typeof mod.createUserMessage === 'function') {
        return mod.createUserMessage({ content: [{ type: 'text', text: text }], source: { kind: 'plugin:dsh-anima' } })
      }
    } catch (error) { /* 宿主没暴露这个包就退回手搓的形状 */ }
    return {
      role: 'user',
      content: [{ type: 'text', text: text }],
      source: { kind: 'plugin:dsh-anima' },
      createdAt: nowIso(),
    }
  }

  /**
   * 小爱没答上来 → 开一个她自己的回合，让她想一句、再用音箱说出来。
   * 回合只为一个问题开一次（同一个 session 复用），说完就待在那儿。
   */
  async function askHerToAnswer(question, device) {
    if (earsSpeaking) { traceEars('ask skip: 上一句还没说完'); return false }
    earsSpeaking = true
    traceEars('ask start')
    try {
      if (!earsTurn) {
        if (!ctx.agents || typeof ctx.agents.create !== 'function') throw new Error('宿主没给 agents')
        // 宿主不会替你挑模型：不给 provider/model 建出来的 agent 是空壳，
        // 第一次回合就报 'has no provider/model'
        const selection = (ctx.agentDefaultModel && typeof ctx.agentDefaultModel.currentSelection === 'function')
          ? ctx.agentDefaultModel.currentSelection()
          : undefined
        if (!selection || !selection.provider || !selection.model) throw new Error('拿不到默认模型（agentDefaultModel.currentSelection 为空）')
        earsTurn = await ctx.agents.create({
          sessionId: 'anima-ears-' + Date.now().toString(36),
          meta: { cwd: process.cwd() },
          agentOptions: { provider: selection.provider, model: selection.model },
        })
      }
      const text = '（音箱那边）主人问：「' + question + '」，小爱没答上来。'
        + '请你用一句话回答，口语、别超 40 字、不要列表和 markdown。'
        + '然后立刻用 xiaomi_say 把这句话送到「' + (device.name || device.hardware || '音箱') + '」那台音箱上，让主人真的听见。'
        + '不要解释过程，不要复述我这段话。'
      earsTurn.agent.followup(await makeUserMessage(text))
      traceEars('ask ok: 回合已发（' + (earsTurn.agent.session ? earsTurn.agent.session.id : '?') + '）')
      return true
    } catch (error) {
      ears.lastError = '接话失败：' + (error && error.message ? error.message : String(error))
      traceEars('ask fail: ' + ears.lastError)
      if (ctx.logger && ctx.logger.warn) ctx.logger.warn('dsh-anima: ' + ears.lastError)
      return false
    } finally {
      earsSpeaking = false
    }
  }

  // 控制中心里的对话框：主人直接在面板上跟她说话（走她自己的一个常驻回合）。
  let consoleTurn = null
  let consoleBusy = false

  async function sayToHer(text) {
    if (consoleBusy) return { ok: false, error: '上一句还没发完' }
    consoleBusy = true
    try {
      if (!consoleTurn) {
        if (!ctx.agents || typeof ctx.agents.create !== 'function') throw new Error('宿主没给 agents')
        const selection = (ctx.agentDefaultModel && typeof ctx.agentDefaultModel.currentSelection === 'function')
          ? ctx.agentDefaultModel.currentSelection()
          : undefined
        if (!selection || !selection.provider || !selection.model) throw new Error('拿不到默认模型（agentDefaultModel.currentSelection 为空）')
        consoleTurn = await ctx.agents.create({
          sessionId: 'anima-console-' + Date.now().toString(36),
          meta: { cwd: process.cwd() },
          agentOptions: { provider: selection.provider, model: selection.model },
        })
      }
      consoleTurn.agent.followup(await makeUserMessage(text))
      return { ok: true }
    } catch (error) {
      consoleTurn = null
      return { ok: false, error: error && error.message ? error.message : String(error) }
    } finally {
      consoleBusy = false
    }
  }

  async function pollEarsOnce() {
    if (ears.busy) return { ok: true, fresh: 0, skipped: 'busy' }
    ears.busy = true
    try {
      const token = xiaomi.loadToken()
      if (!token) {
        ears.lastError = 'no-token'
        return { ok: false, reason: 'no-token' }
      }
      const devices = await xiaomi.deviceList(token)
      const targets = ears.device ? devices.filter(function (row) { return pickSpeaker([row], ears.device) }) : devices
      const fresh = []
      for (const device of targets) {
        let rows = []
        try {
          rows = await xiaomi.latestAsk(token, device.deviceID, device.hardware)
        } catch (error) {
          ears.lastError = error && error.message ? error.message : String(error)
          continue
        }
        for (const row of rows) {
          if (!markSeen(row.requestId)) continue
          if (!row.question) continue
          fresh.push({ device: device, row: row })
        }
      }
      if (fresh.length || ears.lastError) traceEars('poll fresh=' + fresh.length + ' reply=' + ears.reply + ' delivered=' + ears.delivered + ' err=' + JSON.stringify(String(ears.lastError || '').slice(0, 80)))
      for (const item of fresh) {
        try {
          await deliverEarsQuestion(item.row.question)
          ears.delivered += 1
          const isFresh = (Date.now() - Number(item.row.timestampMs || 0)) < 90000
          const byName = calledHer(item.row.question)
          const stuck = looksStuck(item.row.answer)
          const willAnswer = ears.reply && isFresh && (byName || stuck)
          traceEars('Q=' + JSON.stringify(String(item.row.question || '').slice(0, 40))
            + ' A=' + JSON.stringify(String(item.row.answer || '').slice(0, 60))
            + ' age=' + Math.round((Date.now() - Number(item.row.timestampMs || 0)) / 1000) + 's'
            + ' fresh=' + isFresh + ' reply=' + ears.reply + ' byName=' + byName + ' stuck=' + stuck
            + ' -> ' + (willAnswer ? '接话' : '不接'))
          // 只有「小爱答不上来、她来接」的那一问才进最近对话：小爱自己能答的不算她和主人的对话
          if (willAnswer) {
            pushRecentChat('user', item.row.question, 'xiaomi')
            await askHerToAnswer(item.row.question, item.device)
          }
        } catch (error) {
          ears.lastError = error && error.message ? error.message : String(error)
          traceEars('loop fail: ' + (error && error.stack ? String(error.stack).split('\n').slice(0, 4).join(' << ') : String(error)))
        }
      }
      ears.lastPollAt = nowIso()
      if (fresh.length) ears.lastError = ''
      if (fresh.length && ctx.logger && ctx.logger.info) {
        const marks = fresh.map(function (item) {
          const txt = String(item.row.answer || '')
          return (calledHer(item.row.question) ? '点名' : '') + (looksStuck(txt) ? '答不上' : '正常')
        })
        ctx.logger.info('dsh-anima: 耳朵收到 ' + fresh.length + ' 条；reply=' + ears.reply + '；判定=' + marks.join(','))
      }
      return { ok: true, fresh: fresh.length }
    } finally {
      ears.busy = false
    }
  }

  function stopEars() {
    if (ears.timer) clearInterval(ears.timer)
    ears.timer = null
    ears.on = false
  }

  async function startEars(opts) {
    const body = opts || {}
    const interval = Math.max(1500, Number(body.intervalMs) || 3000)
    stopEars()
    ears.intervalMs = interval
    ears.device = typeof body.device === 'string' ? body.device.trim() : ''
    if (body.reply !== undefined) ears.reply = body.reply !== false
    const token = xiaomi.loadToken()
    if (!token) {
      ears.lastError = 'no-token'
      return { ok: false, reason: 'no-token', hint: '先跑 node scripts/mi-login.mjs 登录小米账号' }
    }
    // 开耳朵的第一件事是把「已经问过的」全部记下来：否则刚打开就会把历史问题当新话重放
    try {
      const devices = await xiaomi.deviceList(token)
      for (const device of devices) {
        const rows = await xiaomi.latestAsk(token, device.deviceID, device.hardware)
        for (const row of rows) markSeen(row.requestId)
      }
      ears.lastError = ''
    } catch (error) {
      ears.lastError = error && error.message ? error.message : String(error)
    }
    ears.on = true
    ears.timer = setInterval(function () {
      pollEarsOnce().catch(function (error) {
        ears.lastError = error && error.message ? error.message : String(error)
      })
    }, interval)
    if (typeof ears.timer.unref === 'function') ears.timer.unref()
    return { ok: true, data: earsStatus() }
  }

  // ---- HTTP routes: the dashboard reads and adjudicates through these ----
  // webServer 不能写进静态 inject：headless 值班 profile 没有它，硬依赖会让插件永不激活。
  // 也不能只在 apply 里抓一次：apply 可能早于 webServer 就绪，抓到 null 就永远挂不上
  // （2026-11-01 桌面端控制中心读 /anima/api/status 得 HTTP 404 正是这个原因）。
  // 做法：现在就绪就立刻挂；还没就绪就用 ctx.inject 等它出现再挂。
  function pickWebServer(scope) {
    try {
      return scope && typeof scope.get === 'function' ? scope.get('webServer') : null
    } catch (error) {
      return null
    }
  }

  function mountAnimaRoutes(webServer) {
    if (!webServer || typeof webServer.register !== 'function') return
    // 有音箱就把耳朵开着：她该一直听着，不该靠谁去控制台点一下——点没点、点的是哪一版
    // 页面，都变成了猜谜（2026-11-08 连着两轮「说了但没反应」就是卡在这）。
    // 只在这里开（= 挂上路由的那个进程）：值班 headless 进程也装 anima，
    // 两边同开会把同一条提问喂两遍、还会双份接话。
    if (xiaomi.loadToken()) {
      startEars({}).then(function (info) {
        const ok = !info || info.ok !== false
        if (ctx.logger && ctx.logger.info) {
          ctx.logger.info('dsh-anima: 耳朵自动' + (ok ? '开启成功' : '开启失败（' + ((info && info.reason) || '') + '）'))
        }
      }).catch(function (error) {
        if (ctx.logger && ctx.logger.warn) ctx.logger.warn('dsh-anima: 耳朵自动开启失败 ' + (error && error.message ? error.message : error))
      })
    }
    ctx.effect(function () {
      return webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async function (req, res) {
          if (denyNonLoopback(req, res, allowLan)) return
          const url = String(req.url || '')
          const pathname = url.split('?')[0].slice(ROUTE.length) || '/'
          const query = url.indexOf('?') >= 0 ? url.slice(url.indexOf('?') + 1) : ''
          try {
            if (req.method === 'GET' && pathname === '/status') {
              return sendJson(res, 200, { ok: true, data: summarize() })
            }
            if (req.method === 'GET' && pathname === '/pending') {
              refreshSync()
              const limit = Number((query.match(/(?:^|&)limit=(\d+)/) || [])[1] || 20)
              const rows = pendingMemories(state.memory).slice(0, limit)
              return sendJson(res, 200, { ok: true, data: { total: pendingMemories(state.memory).length, entries: rows } })
            }
            if (req.method === 'GET' && pathname === '/approved') {
              refreshSync()
              const rows = approvedMemories(state.memory, state.cwd, 200)
              return sendJson(res, 200, { ok: true, data: { total: rows.length, entries: rows } })
            }
            if (req.method === 'GET' && pathname === '/settings') {
              refreshSync()
              return sendJson(res, 200, { ok: true, data: { memoryScope: state.settings.memoryScope, channelPrefixes: state.settings.channelPrefixes, channelProfile: channelProfile } })
            }
            if (req.method === 'POST' && pathname === '/settings') {
              const body = await readBody(req)
              const next = Object.assign({}, state.settings)
              if (body && typeof body.memoryScope === 'string') {
                if (body.memoryScope !== 'global' && body.memoryScope !== 'onesoul') {
                  return sendJson(res, 400, { ok: false, error: 'memoryScope 只能是 global 或 onesoul' })
                }
                next.memoryScope = body.memoryScope
              }
              if (body && Array.isArray(body.channelPrefixes)) {
                next.channelPrefixes = body.channelPrefixes
              }
              state.settings = normalizeSettings(next)
              await persistSettings()
              appendLedger('settings', { memoryScope: state.settings.memoryScope })
              return sendJson(res, 200, { ok: true, data: { memoryScope: state.settings.memoryScope, channelPrefixes: state.settings.channelPrefixes, channelProfile: channelProfile } })
            }
            if (req.method === 'GET' && pathname === '/ephemeral') {
              const data = ephemeralSync()
              const sum = ephemeralSummary(data)
              const rows = queryEphemeral(data, { limit: 200 })
              return sendJson(res, 200, { ok: true, data: { ...sum, source: data.source, entries: rows } })
            }
            if (req.method === 'POST' && pathname === '/ephemeral/refresh') {
              const result = await refreshEphemeralSafe('http')
              const sum = ephemeralSummary(ephemeralSync())
              return sendJson(res, 200, { ok: true, data: { ...sum, captured: result.captured || 0, dir: result.dir || null, file: result.file || null } })
            }
            if (req.method === 'GET' && pathname === '/persona') {
              refreshSync()
              return sendJson(res, 200, { ok: true, data: summarize().effective })
            }
            if (req.method === 'GET' && pathname === '/runtime') {
              refreshSync()
              return sendJson(res, 200, {
                ok: true,
                data: {
                  summary: summarizeRuntime(state.runtime, nowIso()),
                  runtime: state.runtime,
                  rooms: ROOMS,
                  moodLabel: valenceLabel(state.runtime.mood.valence),
                },
              })
            }
            if (req.method === 'POST' && pathname === '/runtime/event') {
              const body = await readBody(req, 64 * 1024)
              const result = await serialize(async function () {
                refreshSync()
                state.runtime = applyRuntimeEvent(state.runtime, normalizeUiEvent(body), nowIso())
                await persistRuntime()
                return { runtime: state.runtime, summary: summarizeRuntime(state.runtime, nowIso()) }
              })
              return sendJson(res, 200, { ok: true, data: result })
            }
            if (req.method === 'POST' && pathname === '/chat') {
              const body = await readBody(req, 64 * 1024)
              const text = typeof body.text === 'string' ? body.text.trim() : ''
              if (!text) return sendJson(res, 400, { ok: false, error: 'text 不能为空' })
              refreshSync()
              const sent = await sayToHer(text.slice(0, 2000))
              if (!sent.ok) return sendJson(res, 502, { ok: false, error: sent.error || '回合发不出去' })
              // 插件发出去的消息 source.kind 不是 user，总线不会替我们记，这里补一条
              pushRecentChat('user', text, 'anima-console')
              return sendJson(res, 200, { ok: true, data: { sent: true } })
            }
            if (req.method === 'GET' && pathname === '/recent-chat') {
              const limit = Number((query.match(/(?:^|&)limit=(\d+)/) || [])[1] || 8)
              refreshSync()
              const allow = visibleChannels()
              const rows = readRecentChat().filter((row) => allow.indexOf(row && row.channel) >= 0)
              return sendJson(res, 200, { ok: true, data: { total: rows.length, scope: state.settings.memoryScope, channels: allow, rows: rows.slice(-Math.max(1, limit)) } })
            }
            if (req.method === 'POST' && pathname === '/speak') {
              const body = await readBody(req, 64 * 1024)
              const text = typeof body.text === 'string' ? body.text.trim() : ''
              if (!text) return sendJson(res, 400, { ok: false, error: 'text 不能为空' })
              refreshSync()
              const gate = canSpeak(state.runtime.quiet, nowIso(), { urgent: body.force === true })
              if (!gate.ok && body.force !== true) {
                const queued = await serialize(async function () {
                  refreshSync()
                  state.runtime.quiet = noteSuppressed(state.runtime.quiet, { kind: 'speak', text: text }, nowIso())
                  state.runtime.updatedAt = nowIso()
                  await persistRuntime()
                  return true
                })
                return sendJson(res, 200, { ok: true, data: { spoken: false, reason: gate.reason, queued: queued } })
              }
              try {
                const made = await speak(text, { play: body.play !== false, engine: body.engine, voice: body.voice })
                return sendJson(res, 200, { ok: true, data: { spoken: true, engine: made.engine, bytes: made.bytes, path: made.path, file: made.path.split(/[\\/]/).pop() } })
              } catch (error) {
                return sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
              }
            }
            if (req.method === 'GET' && pathname === '/xiaomi/devices') {
              const token = xiaomi.loadToken()
              if (!token) {
                return sendJson(res, 200, { ok: false, reason: 'no-token', hint: '先跑 node scripts/mi-login.mjs 登录小米账号', ears: earsStatus() })
              }
              try {
                const devices = await xiaomi.deviceList(token)
                return sendJson(res, 200, { ok: true, data: { total: devices.length, devices: devices, ears: earsStatus() } })
              } catch (error) {
                return sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
              }
            }
            if (req.method === 'POST' && pathname === '/xiaomi/say') {
              const body = await readBody(req, 64 * 1024)
              const text = typeof body.text === 'string' ? body.text.trim() : ''
              if (!text) return sendJson(res, 400, { ok: false, error: 'text 不能为空' })
              try {
                const result = await xiaomiSay({ text: text, device: body.device, force: body.force === true, engine: body.engine, voice: body.voice })
                return sendJson(res, 200, { ok: true, data: result })
              } catch (error) {
                return sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
              }
            }
            if (req.method === 'GET' && pathname === '/xiaomi/ears') {
              // 带上当前选中的局域网 IP：音箱拉不到音频时，第一眼要能看出选错了网卡
              return sendJson(res, 200, { ok: true, data: Object.assign(earsStatus(), { lanIp: await lanIpv4() }) })
            }
            if (req.method === 'POST' && pathname === '/xiaomi/ears') {
              const body = await readBody(req, 64 * 1024)
              if (body.on === false) {
                stopEars()
                return sendJson(res, 200, { ok: true, data: earsStatus() })
              }
              const started = await startEars(body)
              if (!started.ok) return sendJson(res, 200, { ok: false, reason: started.reason, hint: started.hint, data: earsStatus() })
              return sendJson(res, 200, { ok: true, data: started.data })
            }
            if (req.method === 'POST' && pathname === '/decide') {
              const body = await readBody(req, 256 * 1024)
              const result = await serialize(async function () {
                refreshSync()
                const decision = String(body.decision || '')
                if (decision !== 'approve' && decision !== 'reject') throw new Error('decision 必须是 approve 或 reject')
                const pending = pendingMemories(state.memory)
                const target = body.id === 'latest'
                  ? pending[pending.length - 1]
                  : state.memory.entries.filter(function (entry) { return entry.id === body.id })[0]
                if (!target) throw new Error('找不到该记忆：' + String(body.id))
                if (target.status !== 'candidate') throw new Error('该记忆已裁决过：' + target.status)
                target.status = decision === 'approve' ? 'approved' : 'rejected'
                target.reviewedAt = nowIso()
                if (typeof body.note === 'string') target.note = body.note
                await persistMemory()
                return { id: target.id, status: target.status, text: target.text }
              })
              return sendJson(res, 200, { ok: true, data: result })
            }
            if (req.method === 'POST' && pathname === '/capture') {
              const body = await readBody(req, 256 * 1024)
              if (typeof body.text !== 'string' || !body.text.trim()) throw new Error('text 不能为空')
              const entry = await serialize(async function () {
                refreshSync()
                const row = {
                  id: newId('mem'),
                  text: body.text.trim().slice(0, 2000),
                  tags: Array.isArray(body.tags) ? body.tags.filter(function (t) { return typeof t === 'string' }) : [],
                  source: typeof body.source === 'string' ? body.source : 'dashboard',
                  scope: 'global',
                  status: 'candidate',
                  createdAt: nowIso(),
                  reviewedAt: null,
                  note: '',
                }
                state.memory.entries.push(row)
                await persistMemory()
                return row
              })
              return sendJson(res, 200, { ok: true, data: entry })
            }
            if (req.method === 'POST' && pathname === '/persona') {
              const body = await readBody(req, 256 * 1024)
              const saved = await serialize(async function () {
                refreshSync()
                const patch = {}
                for (const key of PERSONA_FIELDS) {
                  if (typeof body[key] === 'string' && body[key].trim()) patch[key] = body[key].trim()
                }
                if (Array.isArray(body.boundaries)) {
                  patch.boundaries = body.boundaries.filter(function (item) { return typeof item === 'string' && item.trim() })
                }
                if (!Object.keys(patch).length) throw new Error('没有可写入的字段')
                patch.updatedAt = nowIso()
                state.persona.global = { ...state.persona.global, ...patch }
                await persistPersona()
                return state.persona.global
              })
              return sendJson(res, 200, { ok: true, data: saved })
            }
            return sendJson(res, 404, { ok: false, error: 'unknown route', path: pathname })
          } catch (error) {
            return sendJson(res, 400, { ok: false, error: error && error.message ? error.message : String(error) })
          }
        },
      })
    })
  }

  const liveWebServer = pickWebServer(ctx)
  if (liveWebServer) {
    mountAnimaRoutes(liveWebServer)
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], function (inner) {
      mountAnimaRoutes(pickWebServer(inner))
    })
  }

  // ---- first load: 同步读取，避免异步首读与随后的写入互相覆盖 ----
  try {
    ensureDirSync()
    state.persona = normalizeState(readJsonSync(personaPath(), null))
    state.memory = normalizeMemory(readJsonSync(memoryPath(), null))
    state.personaStamp = stampOf(personaPath())
    state.memoryStamp = stampOf(memoryPath())
  } catch (error) {
    ctx.logger && ctx.logger.warn && ctx.logger.warn('dsh-anima: 初始化失败 ' + (error && error.message ? error.message : error))
  }

  // 临时记忆：启动抽一次，之后每 15 分钟对齐一次（值班写完报告后不用重启就能被看到）
  refreshEphemeralSafe('startup')
  const ephemeralTimer = setInterval(function () { refreshEphemeralSafe('tick') }, 15 * 60 * 1000)
  if (typeof ephemeralTimer.unref === 'function') ephemeralTimer.unref()

  // 她自己会走动：每 60 秒推一次 tick，只有位置/心情真的变了才写盘（否则白写磁盘还触发别处重读）
  const runtimeTimer = setInterval(function () {
    serialize(async function () {
      const before = JSON.stringify(state.runtime.presence) + JSON.stringify(state.runtime.mood) + JSON.stringify(state.runtime.quiet)
      const next = applyRuntimeEvent(state.runtime, { type: 'tick' }, nowIso())
      const after = JSON.stringify(next.presence) + JSON.stringify(next.mood) + JSON.stringify(next.quiet)
      if (after === before) return
      state.runtime = next
      await persistRuntime()
    }).catch(function (error) {
      ctx.logger && ctx.logger.warn && ctx.logger.warn('dsh-anima: 运行时 tick 失败 ' + (error && error.message ? error.message : error))
    })
  }, 60 * 1000)
  if (typeof runtimeTimer.unref === 'function') runtimeTimer.unref()

  // 耳朵的自动开启在 mountAnimaRoutes 里（只有挂上路由的进程才开，见那儿注释）。
  return { DEFAULT_PERSONA, defaultPersona: DEFAULT_PERSONA }
}
