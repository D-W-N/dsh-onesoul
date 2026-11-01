/**
 * QQ 分句：运行时接管 dsh-onebot-qq 的出站管线，把一段回复按「一句一条消息」发出去。
 *
 * 起因：dsh-onebot-qq/lib/outbound.js:84-103 只有一条规则 —— 回复字数 > textImageThreshold
 * （默认 150）就整段渲染成一张文字图卡片，它自己没有「分成多条」的能力。
 *
 * 做法：patch OutboundPipeline.prototype.sendToChat（bridge.js:279 是纯委托，
 * 所以改原型就够了），切分后逐条交给原实现发送 —— 原实现的 markdown 清洗、
 * 敏感词审计、[[qq_forward]]、离线补发队列都照旧生效。
 * 不改第三方文件 ⇒ 升级/重装 dsh-onebot-qq 后依然有效；对方结构变了就跳过（reason）。
 *
 * 切分规则见 splitBySentence 上方的常量表：省略号不算句末、括号与引号里不切、
 * 表情标记整段保住、只有单句超长才在括号外的顿号逗号处断。
 *
 * 配套：三个 patch 里把 textImageThreshold 设成 0（= 永不出文字图卡片）。
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * 找到 dsh-onebot-qq 的 lib/outbound.js **同一个模块实例**。
 * 它的 exports 只放行 "."、"./client"、"./settings-remote"、"./package.json"，
 * 所以不能直接 import 子路径；改用 package.json 定位包目录再按绝对路径 import ——
 * 路径与插件自己 import('./outbound.js') 解析出的 URL 相同，ESM 缓存因此命中同一实例。
 */
async function loadOutbound() {
  const tries = []
  try {
    const require = createRequire(import.meta.url)
    tries.push(join(dirname(require.resolve('dsh-onebot-qq/package.json')), 'lib', 'outbound.js'))
  } catch {}
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i += 1) {
    tries.push(join(dir, 'node_modules', 'dsh-onebot-qq', 'lib', 'outbound.js'))
    dir = dirname(dir)
  }
  for (const file of tries) {
    if (!existsSync(file)) continue
    try {
      const mod = await import(pathToFileURL(file).href)
      if (mod && mod.OutboundPipeline) return mod
    } catch {}
  }
  return null
}

const PATCHED = Symbol.for('dsh-companion.qq-split')

/** 第一次有出站调用时捕获到的 OutboundPipeline 实例（主动发消息要用它）。 */
let captured = null
/** 插件原来的 sendToChat（未打补丁的那份）；主动整段推送要绕过分句时用它。 */
import { takeMemeMarkers, sendMemeImages } from './meme-inline.js'

let originalSendToChat = null

export function outboundStatus() {
  return captured ? { ok: true } : { ok: false, reason: 'no-outbound-yet' }
}

/**
 * 捕获到的 bridge 实例（dsh-onebot-qq/lib/bridge.js 的 ChatBridge）。
 * 切换 QQ 聊天模型要读它的 chats 表（bridge.js:60 `get chats() { return this.registry.chats; }`）。
 */
export function currentBridge() {
  return captured
}

/**
 * 主动发一条纯文本到指定会话（private:<qq> / group:<群号>）。
 * 走插件自己的出站管道，所以 markdown 清洗、敏感词审计、断线排队、分句都照旧。
 */
export async function sendText(chatId, text) {
  if (!captured) throw new Error('还没有捕获到出站管道：先让机器人收到任意一条 QQ 消息')
  return captured.sendToChat(String(chatId), String(text), {})
}

/**
 * 主动发一条「整段」消息：跳过按句分条，保持一条就是一条（值班摘要这种成段的推送用它）。
 * 插件的 markdown 清洗、敏感词审计、断线排队照旧，只是不分句。
 */
export async function sendOneMessage(chatId, text) {
  if (!captured) throw new Error('还没有捕获到出站管道：先让机器人收到任意一条 QQ 消息')
  const target = originalSendToChat || captured.sendToChat
  return target.call(captured, String(chatId), String(text), {})
}
export const MAX_CHUNK = 180
export const MAX_MESSAGES = 12
const GAP_MS = 350

/** 只有这些才算句末。省略号（…）刻意不在里面 —— 它大多出现在句子中间，
 *  按它切会把「那 mi 八成是……米？」切成「…」「米？」两条（2026-11-01 真机实测）。 */
const ENDERS = new Set(['。', '！', '？', '!', '?', '\n'])
/** 断句后要跟着粘住的收尾符号（引号、括号、省略号、连写标点）。 */
const TRAILERS = new Set(['）', '】', '」', '』', '”', ')', ']', '…', '。', '！', '？', '!', '?', '～', '~'])
/** 括号类：里面的标点一律不算句末 —— [表情: …]、链接、括注靠它整段保住。 */
const BRACKETS = { '[': ']', '（': '）', '(': ')', '【': '】', '《': '》' }
/** 引号成对保护；但跨行就当没收住，免得一个漏引号把整条回复吞成一条。 */
const QUOTES = { '“': '”', '「': '」', '『': '』' }
/** 只有标题样子的短片段（**一、扫的范围** / ### 标题）不单独发，粘到下一句前面。 */
const BARE_HEADING = /^(?:\*\*[^*\n]{1,24}\*\*|#{1,6}\s[^\n]{1,40})$/

/** 按句末标点切段：括号、引号里的标点不切，句末后面跟着的收尾符号一起粘住。 */
function cutPieces(src) {
  const pieces = []
  let buf = ''
  const stack = []
  let quote = ''
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (stack.length > 0) {
      buf += ch
      if (ch === stack[stack.length - 1]) stack.pop()
      continue
    }
    if (BRACKETS[ch]) {
      stack.push(BRACKETS[ch])
      buf += ch
      continue
    }
    if (quote !== '') {
      buf += ch
      if (ch === quote) quote = ''
      continue
    }
    if (QUOTES[ch]) {
      quote = QUOTES[ch]
      buf += ch
      continue
    }
    buf += ch
    if (ch === '\n') {
      pieces.push(buf)
      buf = ''
      continue
    }
    if (ENDERS.has(ch)) {
      while (i + 1 < src.length) {
        const next = src[i + 1]
        if (!TRAILERS.has(next) || BRACKETS[next] || QUOTES[next]) break
        buf += next
        i += 1
      }
      quote = ''
      pieces.push(buf)
      buf = ''
    }
  }
  if (buf !== '') pieces.push(buf)
  return pieces
}

/** 标出哪些字符在括号里面（长句只能在括号外断，免得把 [表情: …] 劈开）。 */
function insideMask(s) {
  const mask = new Array(s.length).fill(false)
  const stack = []
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (stack.length > 0) {
      mask[i] = true
      if (ch === stack[stack.length - 1]) stack.pop()
      continue
    }
    if (BRACKETS[ch]) {
      mask[i] = true
      stack.push(BRACKETS[ch])
    }
  }
  return mask
}

/** 单句超过上限：先在括号外的逗号/顿号处断，没有就硬切。 */
function cutLong(sentence, limit) {
  const mask = insideMask(sentence)
  const out = []
  let rest = sentence
  let offset = 0
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    let at = -1
    for (const mark of ['，', '、', ',', '；', ';']) {
      for (let i = window.length - 1; i > limit * 0.5; i -= 1) {
        if (window[i] === mark && mask[offset + i] !== true) {
          at = i + 1
          break
        }
      }
      if (at > 0) break
    }
    if (at <= 0) at = limit
    const head = rest.slice(0, at).trim()
    if (head !== '') out.push(head)
    offset += at
    rest = rest.slice(at)
  }
  const tail = rest.trim()
  if (tail !== '') out.push(tail)
  return out
}

/** 句子多到超过 MAX_MESSAGES 时，只合并「最短的相邻两条」，长句各自独立。 */
function mergeShortest(list, max) {
  const arr = list.slice()
  while (arr.length > max) {
    let at = 0
    let best = Infinity
    for (let i = 0; i + 1 < arr.length; i += 1) {
      const len = arr[i].length + arr[i + 1].length
      if (len < best) {
        best = len
        at = i
      }
    }
    arr.splice(at, 2, arr[at] + arr[at + 1])
  }
  return arr
}

/**
 * 一句话一条消息：按句末标点切开，每句单独发（不攒到 180 字再发）。
 * 只有单句本身超过 max 时，才在括号外的逗号/顿号处断开、再不行硬切。
 * 句子数超过 MAX_MESSAGES 时合并最短的相邻两条，避免一条回答刷出几十条消息（2026-11-01 按用户选择从 24 压到 12）。
 */
export function splitBySentence(text, max = MAX_CHUNK) {
  const src = String(text === undefined || text === null ? '' : text).replace(/\r\n?/g, '\n')
  if (!src.trim()) return []
  const limit = Number.isFinite(max) && max >= 8 ? Math.floor(max) : MAX_CHUNK

  const sentences = []
  let pending = ''
  for (const raw of cutPieces(src)) {
    const piece = raw.trim()
    if (piece === '') continue
    if (BARE_HEADING.test(piece)) {
      pending = piece
      continue
    }
    sentences.push((pending + piece).trim())
    pending = ''
  }
  if (pending !== '') sentences.push(pending)

  const out = []
  for (const sentence of sentences) {
    // 整条只有表情/图片标记时，挂到上一条末尾，别单独刷一条
    if (/^\[[^\[\]]{1,120}\]$/.test(sentence) && out.length > 0) {
      out[out.length - 1] = out[out.length - 1] + '\n' + sentence
      continue
    }
    if (sentence.length <= limit) {
      out.push(sentence)
      continue
    }
    for (const row of cutLong(sentence, limit)) out.push(row)
  }
  return mergeShortest(out, MAX_MESSAGES)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const RETRY_MS = 800
const SEND_TRIES = 3
const TAIL_OK = /[。！？!?…%）)】」』”"'~～\]]$/

/**
 * 结尾没有句末符号、也没有表情标记收尾，就当成「说到一半被打断」。
 * 真机反例（2026-11-01 05:52，onebot-private-3953927738 turn 5）：正文停在
 * 「这半年的插件都在给 AI 加感官、加手脚——能看网页」，那一轮 usage.outputTokens 1944 就收尾、
 * turn/end 记的是 completed，所以链路上没人知道它没写完，用户只看到半句话。
 */
export function looksUnfinished(text) {
  const body = String(text === undefined || text === null ? '' : text).trim()
  // 短回复本来就不打句号（「主人好呀」「我记性好着呢」），只有长回复才判这句
  if (body.length < 120) return false
  const rows = body.split('\n').filter((row) => row.trim() !== '')
  const last = rows.length > 0 ? rows[rows.length - 1].trim() : ''
  if (/^\[[^\[\]]{1,120}\]$/.test(last)) return false
  return !TAIL_OK.test(body)
}

export const UNFINISHED_NOTE = '（说到一半就断了，要我接着说吗？）'

/**
 * 装一次分句。返回 { ok, reason, chunks, restore }。
 * reason：onebot-unavailable（没装）/ unsupported-version（没有 OutboundPipeline.sendToChat）。
 */
export async function installQqSplit() {
  const mod = await loadOutbound()
  if (!mod) return { ok: false, reason: 'onebot-unavailable' }
  const proto = mod && mod.OutboundPipeline && mod.OutboundPipeline.prototype
  if (!proto || typeof proto.sendToChat !== 'function') {
    return { ok: false, reason: 'unsupported-version' }
  }
  if (proto.sendToChat[PATCHED]) return { ok: true, reason: 'already-installed', chunks: MAX_CHUNK }

  const original = proto.sendToChat
  originalSendToChat = original
  async function sendToChatWithSplit(chatId, text, options = {}) {
    let body = typeof text === 'string' ? text : ''
    captured = this
    if (!body) return original.call(this, chatId, text, options)
    // [表情: 描述] 在 QQ 通道没有前端配图器，先换成真图；换不掉的退回文字，绝不静默丢内容。
    const memeIds = []
    const meme = takeMemeMarkers(body)
    if (meme.captions.length > 0) {
      body = meme.text
      const result = await sendMemeImages(this, chatId, meme.captions, {
        log: (level, message) => {
          if (this.ctx && typeof this.ctx.log === 'function') this.ctx.log(level, message)
        },
      })
      memeIds.push(...result.sent)
      if (result.missed.length > 0) {
        const restored = result.missed.map((caption) => '[表情: ' + caption + ']').join('')
        body = body === '' ? restored : body + '\n' + restored
      }
    }
    if (body === '') return memeIds
    const chunks = splitBySentence(body)
    if (chunks.length === 0) return original.call(this, chatId, text, options)
    if (looksUnfinished(body)) chunks[chunks.length - 1] = chunks[chunks.length - 1] + '\n' + UNFINISHED_NOTE
    if (chunks.length <= 1) {
      const single = await original.call(this, chatId, chunks[0], options)
      if (memeIds.length === 0) return single
      return Array.isArray(single) ? memeIds.concat(single) : memeIds.concat([single])
    }
    const ids = []
    for (let i = 0; i < chunks.length; i += 1) {
      if (i > 0) await sleep(GAP_MS)
      let sent = null
      let lastError = null
      for (let tries = 0; tries < SEND_TRIES && sent === null; tries += 1) {
        if (tries > 0) await sleep(RETRY_MS * tries)
        try {
          sent = await original.call(this, chatId, chunks[i], options)
        } catch (error) {
          lastError = error
        }
      }
      if (sent === null) {
        // 这一条三次都没发出去：记下来，但不再 break —— 旧版 break 会把后面整段一起吞掉，
        // 用户只看到开头几条，剩下的凭空消失（2026-11-01 05:52 那条就是这么断的怀疑点之一）。
        if (this.ctx && typeof this.ctx.log === 'function') {
          this.ctx.log('warn', 'split send failed at chunk ' + (i + 1) + '/' + chunks.length + ': ' + String(lastError && lastError.message ? lastError.message : lastError))
        }
        continue
      }
      if (Array.isArray(sent)) ids.push(...sent)
    }
    return ids
  }
  sendToChatWithSplit[PATCHED] = true
  proto.sendToChat = sendToChatWithSplit
  return {
    ok: true,
    chunks: MAX_CHUNK,
    restore: function () {
      proto.sendToChat = original
    },
  }
}
