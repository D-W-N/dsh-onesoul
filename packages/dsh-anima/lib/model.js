import { newId, nowIso } from './store.js'

export const DEFAULT_PERSONA = {
  name: '阿音',
  userCall: '你',
  role: '用户的长期陪伴型 AI 伙伴：在 DSH 主会话、QQ、B站中始终是同一个角色。',
  style: '自然、口语、简短；先给结论再给理由；不用列表腔和客服腔；不谄媚。',
  boundaries: [
    '不假装记得没有写进长期记忆的事',
    '候选记忆不算事实，不能在回答里当成已知信息使用',
    '涉及发消息、点赞、评论等对外动作时，先说明将要做什么',
  ],
  updatedAt: null,
}

export const PERSONA_FIELDS = ['name', 'userCall', 'role', 'style']

export function emptyState() {
  return { version: 1, global: { ...DEFAULT_PERSONA }, workspaces: {} }
}

export function normalizeState(raw) {
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  const global = { ...base.global }
  if (raw.global && typeof raw.global === 'object') {
    for (const key of PERSONA_FIELDS) {
      if (typeof raw.global[key] === 'string' && raw.global[key].trim()) global[key] = raw.global[key].trim()
    }
    if (Array.isArray(raw.global.boundaries)) {
      global.boundaries = raw.global.boundaries.filter(function (item) { return typeof item === 'string' && item.trim() })
    }
    if (typeof raw.global.updatedAt === 'string') global.updatedAt = raw.global.updatedAt
  }
  const workspaces = {}
  if (raw.workspaces && typeof raw.workspaces === 'object') {
    for (const key of Object.keys(raw.workspaces)) {
      const entry = raw.workspaces[key]
      if (entry && typeof entry === 'object') workspaces[key] = { ...entry }
    }
  }
  return { version: 1, global: global, workspaces: workspaces }
}

export function emptyMemory() {
  return { version: 1, entries: [] }
}

export function normalizeMemory(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) return emptyMemory()
  const entries = raw.entries.filter(function (item) {
    return item && typeof item === 'object' && typeof item.text === 'string' && item.text.trim()
  }).map(function (item) {
    return {
      id: typeof item.id === 'string' && item.id ? item.id : newId('mem'),
      text: item.text.trim(),
      tags: Array.isArray(item.tags) ? item.tags.filter(function (t) { return typeof t === 'string' }) : [],
      source: typeof item.source === 'string' && item.source ? item.source : 'unknown',
      scope: typeof item.scope === 'string' && item.scope ? item.scope : 'global',
      status: item.status === 'approved' || item.status === 'rejected' || item.status === 'revoked' ? item.status : 'candidate',
      evidence: typeof item.evidence === 'string' ? item.evidence : '',
      quarantine: item.quarantine === true,
      derivedFrom: Array.isArray(item.derivedFrom) ? item.derivedFrom.filter(function (x) { return typeof x === 'string' }) : [],
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
      reviewedAt: typeof item.reviewedAt === 'string' ? item.reviewedAt : null,
      revokedAt: typeof item.revokedAt === 'string' ? item.revokedAt : null,
      revokeReason: typeof item.revokeReason === 'string' ? item.revokeReason : '',
      note: typeof item.note === 'string' ? item.note : '',
    }
  })
  return { version: 1, entries: entries }
}

export const MEMORY_SCOPES = ['global', 'onesoul']
export const DEFAULT_CHANNEL_PREFIXES = ['onebot-']

/** settings.json 只放「记忆给谁看」这种运行时开关，跟 persona / memory 分开存。 */
export function normalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const memoryScope = MEMORY_SCOPES.indexOf(src.memoryScope) >= 0 ? src.memoryScope : 'global'
  const prefixes = Array.isArray(src.channelPrefixes)
    ? src.channelPrefixes.filter(function (item) { return typeof item === 'string' && item.trim() }).map(function (item) { return item.trim() })
    : []
  return { version: 1, memoryScope: memoryScope, channelPrefixes: prefixes.length ? prefixes : DEFAULT_CHANNEL_PREFIXES.slice() }
}

/** Onesoul 通道 = 会话 id 以通道前缀开头（QQ 私聊/群是 onebot-private-… / onebot-group-…）。 */
export function isOnesoulChannel(settings, channelId) {
  const id = String(channelId || '')
  if (!id) return false
  const prefixes = (settings && Array.isArray(settings.channelPrefixes) && settings.channelPrefixes.length)
    ? settings.channelPrefixes
    : DEFAULT_CHANNEL_PREFIXES
  return prefixes.some(function (prefix) { return id.indexOf(prefix) === 0 })
}

/** 记忆是否进这个会话：全局模式一律进；「仅 Onesoul」只有通道会话进。 */
export function memoryApplies(settings, channelId) {
  if (!settings || settings.memoryScope !== 'onesoul') return true
  return isOnesoulChannel(settings, channelId)
}

/** Workspace persona overrides the global one field by field; empty fields inherit. */
export function effectivePersona(state, cwd) {
  const global = state.global
  const override = cwd && state.workspaces ? state.workspaces[cwd] : null
  if (!override) return { persona: global, overridden: false }
  const merged = { ...global }
  for (const key of PERSONA_FIELDS) {
    if (typeof override[key] === 'string' && override[key].trim()) merged[key] = override[key].trim()
  }
  if (Array.isArray(override.boundaries) && override.boundaries.length) {
    merged.boundaries = override.boundaries.filter(function (b) { return typeof b === 'string' && b.trim() })
  }
  return { persona: merged, overridden: true }
}

export function approvedMemories(memory, cwd, limit) {
  const cap = typeof limit === 'number' && limit > 0 ? limit : 60
  const rows = memory.entries.filter(function (entry) {
    if (entry.status !== 'approved') return false
    return entry.scope === 'global' || !cwd || entry.scope === cwd
  })
  rows.sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt))
  })
  return rows.slice(0, cap)
}

const INDEX_BRIEF_MAX = 42

/** One index line: id + head of the text + tags. Full text is fetched on demand. */
export function indexLine(entry) {
  const text = String(entry.text || '').replace(/\s+/g, ' ').trim()
  const brief = text.length > INDEX_BRIEF_MAX ? text.slice(0, INDEX_BRIEF_MAX) + '…' : text
  const tags = entry.tags && entry.tags.length ? '（' + entry.tags.join('/') + '）' : ''
  return '- [' + entry.id + '] ' + brief + tags
}

/** Same shape as the prompt index, for tools/HTTP: index only, never the full text. */
export function memoryIndex(memory, cwd, limit) {
  const rows = approvedMemories(memory, cwd, limit)
  return rows.map(function (entry) {
    return {
      id: entry.id,
      brief: String(entry.text || '').replace(/\s+/g, ' ').trim().slice(0, INDEX_BRIEF_MAX),
      tags: entry.tags || [],
      scope: entry.scope,
      createdAt: entry.createdAt,
    }
  })
}

export function findMemory(memory, id) {
  const key = String(id || '').trim()
  if (!key) return null
  return memory.entries.find(function (entry) { return entry.id === key }) || null
}

export function pendingMemories(memory) {
  return memory.entries.filter(function (entry) { return entry.status === 'candidate' })
}
/**
 * 按来源或 id 撤销；被撤销条目的派生条目（derivedFrom 指过来的）一起失效。
 * 参考 BV1iZxB6MEbc 的四层记忆库：记忆的难点不是存多少，是谁有资格写、错了能不能一键收回。
 */
export function revokeMemories(memory, options) {
  const opts = options || {}
  const source = typeof opts.source === 'string' ? opts.source.trim() : ''
  const id = typeof opts.id === 'string' ? opts.id.trim() : ''
  if (!source && !id) return { revoked: [], reason: 'need-source-or-id' }
  const seeds = memory.entries.filter(function (entry) {
    if (id) return entry.id === id
    return entry.source === source
  }).map(function (entry) { return entry.id })
  if (!seeds.length) return { revoked: [], reason: 'no-match' }
  const hit = new Set(seeds)
  let grew = true
  while (grew) {
    grew = false
    for (const entry of memory.entries) {
      if (hit.has(entry.id)) continue
      const parents = entry.derivedFrom || []
      if (parents.some(function (parent) { return hit.has(parent) })) { hit.add(entry.id); grew = true }
    }
  }
  const at = nowIso()
  const revoked = []
  for (const entry of memory.entries) {
    if (!hit.has(entry.id) || entry.status === 'revoked') continue
    entry.status = 'revoked'
    entry.revokedAt = at
    entry.revokeReason = typeof opts.reason === 'string' ? opts.reason.slice(0, 300) : ''
    revoked.push(entry.id)
  }
  return { revoked: revoked, reason: 'ok' }
}

/**
 * Render the injected system-prompt section: persona first, then approved memory only.
 * Candidate memory is never listed here — it is not a fact until the user rules on it.
 */
/** options.memoryApplies === false 时只注入人设与通道小抄，长期记忆与临时记忆都不进提示。 */
export function renderPromptSection(state, memory, cwd, options) {
  const opts = options || {}
  // 设成「仅 Onesoul 通道」时，普通会话一条都不注入：人设、通道小抄、记忆全部隔开。
  if (opts.memoryApplies === false) return ''
  const picked = effectivePersona(state, cwd)
  const persona = picked.persona
  const lines = []
  lines.push('## 你的人设（dsh-anima · 单一灵魂）')
  lines.push('你在 DSH 主会话、QQ 私聊、B站互动中都是同一个角色，人设与记忆完全一致。')
  lines.push('名字：' + persona.name)
  lines.push('称呼用户：' + persona.userCall)
  lines.push('角色：' + persona.role)
  lines.push('风格：' + persona.style)
  if (persona.boundaries && persona.boundaries.length) {
    lines.push('边界：')
    for (const item of persona.boundaries) lines.push('- ' + item)
  }
  if (picked.overridden) lines.push('（当前工作区有独立人设覆盖）')

  const approved = approvedMemories(memory, cwd, 200)
  lines.push('')
  lines.push('## 已确认的长期记忆（索引）')
  if (!approved.length) {
    lines.push('（暂无。需要记住新事时，调用 anima_memory_capture 记为候选，等用户裁决。）')
  } else {
    lines.push('下面每行只是一条记忆的**索引**（编号 + 摘要 + 标签），不是全文。')
    lines.push('判断某条可能用得上时，先调 anima_memory_get（传它的 id）取全文，再据此回答；只记得大概词句、不知道是哪一条时，用 anima_memory_search 按关键词找。没调用就说明手上没有那段内容，不要凭索引编细节。')
    for (const entry of approved) lines.push(indexLine(entry))
    if (approved.length >= 200) lines.push('（索引已截断到 200 条，更多记忆请用 anima_memory_search。）')
  }
  const pending = pendingMemories(memory)
  if (pending.length) {
    lines.push('')
    lines.push('## 待用户裁决的候选记忆（' + pending.length + ' 条）')
    lines.push('以下内容尚未获得用户确认，不得当作已知事实使用；用户裁决通过后会进入上面的长期记忆。')
  }
  lines.push('')
  lines.push('## 通道小抄')
  lines.push('- 发图（QQ 等非网页通道）：先用 send_meme 拿候选，再把挑中那张的 absPath（绝对路径）原样交给图片工具 qq_send_image 的 sources。表情包库（~/.dsh/meme-packs）已在媒体围栏的放行列表里，不用先复制。只有在被拒（提示「不在允许的媒体目录内」）时，才把图复制进 ~/.dsh/media/onebot/ 再发。')
  lines.push('- 图发不出去就立刻改用文字回答，绝不要沉默：宁可只回文字，也不能让对方什么都收不到。')
  lines.push('- [表情: 描述] 这类标记只在网页聊天里用；IM 里不要用文本标记代替真图。')
  lines.push('- IM 里一条回复别写成两千字的长清单：要列就最多 3 条、每条一句，剩下的等对方问。写太长会被输出上限截断，对面只收到半句话。')
  lines.push('- 记忆被撤销（status=revoked）就当作从没记过：不要引用，也不要凭它推理。')
  return lines.join('\n')
}

/** Split imported text into candidate lines: bullets, numbered items, blank-line paragraphs. */
export function extractCandidateTexts(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n')
  const out = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^#/.test(trimmed)) continue
    const cleaned = trimmed.replace(/^([-*+]|\d+[.)])\s*/, '').replace(/^\[.\]\s*/, '').trim()
    if (!cleaned) continue
    if (cleaned.length < 2) continue
    out.push(cleaned.slice(0, 800))
  }
  return out
}
