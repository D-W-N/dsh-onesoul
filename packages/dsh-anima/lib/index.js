/**
 * dsh-anima — 灵魂层。
 *
 * 四件事：人格定义（全局 + 按工作区覆盖）、长期记忆候选捕获、用户裁决闸门、系统提示词注入。
 * 记忆绝不自动写入：capture 只进候选池，只有 decide(approve) 才成为事实。
 */
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

export { KEEP_DAYS, readEphemeralSync, refreshEphemeral, queryEphemeral, renderEphemeralSection, ephemeralSummary }
export const name = 'dsh-anima'
// webServer 是可选的：headless 值班 profile 里没有这个服务，硬依赖会让插件永远不激活。
// 路由在 webServer 存在时才挂（桌面/网页 profile 都有），值班 profile 只用工具与提示注入。
export const inject = ['tools', 'systemPrompt']

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
  const state = { persona: emptyState(), memory: emptyMemory(), settings: normalizeSettings(null), personaStamp: '', memoryStamp: '', settingsStamp: '', cwd: '' }
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
            return renderPromptSection(state.persona, state.memory, state.cwd) + renderEphemeralSection(ephemeralSync())
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

  return { DEFAULT_PERSONA, defaultPersona: DEFAULT_PERSONA }
}
