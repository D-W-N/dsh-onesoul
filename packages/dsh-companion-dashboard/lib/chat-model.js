/**
 * QQ 聊天的模型切换：让控制台的「切换模型」真正下发给每个 QQ 聊天。
 *
 * 起因：dsh-onebot-qq/lib/commands.js:233-236 写明 M2-C5a 语义 —— 裸 /model 只改
 * 「这个聊天」的 selectionRef.current，不再改部署默认；而 dsh-onebot-qq/lib/registry.js:85-96
 * 的 modelWiring() 在**创建聊天那一刻**把当时的部署默认拍进 selectionRef，
 * registry.js:104-106 的 buildSetup() 再把它装进 agent。于是后来改部署默认（控制台写的
 * agent-default-model）对已存在的 QQ 聊天一律无效，那个聊天会一直用旧模型，
 * 表现为「切了别的模型还是报上一个服务的频率超限」。
 *
 * 做法：不改第三方文件，只做两件事 ——
 *   1) patch ChatRegistry.prototype.createChatAgent，记下每个聊天的 selectionRef
 *      （registry.js:47 的 export class ChatRegistry，chats 是 :50 的 Map）；
 *   2) 提供 retargetChats/retargetLiveChats，把新的选择写进 selectionRef.current，
 *      语义与 commands.js:331-332 的 /model 完全一致（只改 .current）。
 * 聊天表的来源优先用 qq-split 捕获的 bridge 实例（bridge.js:60 get chats()），
 * 其次用 patch 记下的 registry 实例。
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PATCHED = Symbol.for('dsh-companion.chat-model')

/** patch 之后记下的 registry 实例（ChatRegistry 的 chats 表从这里读） */
let registryRef = null
/** chatId → selectionRef，patch 时顺手记下，供没有 bridge 实例时兜底诊断 */
const knownRefs = new Map()

function registryHref() {
  try {
    const req = createRequire(import.meta.url)
    const dir = dirname(req.resolve('dsh-onebot-qq/package.json'))
    const file = join(dir, 'lib', 'registry.js')
    return existsSync(file) ? pathToFileURL(file).href : ''
  } catch {
    return ''
  }
}

/** patch ChatRegistry.prototype.createChatAgent；幂等。 */
export async function installChatModel() {
  const g = globalThis
  if (g[PATCHED]) return { ok: true, reason: 'already-installed', tracked: knownRefs.size }
  const href = registryHref()
  if (href === '') return { ok: false, reason: 'no-onebot-module' }
  let mod = null
  try {
    mod = await import(href)
  } catch {
    return { ok: false, reason: 'import-failed' }
  }
  const proto = mod && mod.ChatRegistry ? mod.ChatRegistry.prototype : null
  if (!proto || typeof proto.createChatAgent !== 'function') return { ok: false, reason: 'no-createChatAgent' }
  const original = proto.createChatAgent
  proto.createChatAgent = function createChatAgentTracked(chatId, handle, selectionRef, nickname) {
    registryRef = this
    if (selectionRef !== null && typeof selectionRef === 'object') knownRefs.set(String(chatId), selectionRef)
    return original.call(this, chatId, handle, selectionRef, nickname)
  }
  g[PATCHED] = { original: original }
  return { ok: true, reason: 'installed', tracked: knownRefs.size }
}

/** 聊天表：优先 bridge 实例（bridge.js:60 get chats()），其次 patch 记下的 registry。 */
function liveChats(bridge) {
  if (bridge && bridge.chats instanceof Map) return bridge.chats
  if (registryRef && registryRef.chats instanceof Map) return registryRef.chats
  return null
}

/**
 * 把一份模型选择写进聊天表里的每个聊天。纯函数，便于测试。
 * 只改 selectionRef.current（与 commands.js:331-332 一致），没有 selectionRef 的聊天跳过。
 */
export function retargetChats(chats, next) {
  const out = { switched: 0, skipped: 0, chatIds: [] }
  const rows = []
  if (chats instanceof Map) {
    for (const [id, chat] of chats) rows.push([String(id), chat])
  } else if (Array.isArray(chats)) {
    for (const chat of chats) rows.push([String((chat && chat.chatId) || ''), chat])
  } else if (chats && typeof chats === 'object') {
    for (const id of Object.keys(chats)) rows.push([String(id), chats[id]])
  }
  for (const [id, chat] of rows) {
    const ref = chat && chat.selectionRef
    if (!ref || typeof ref !== 'object') {
      out.skipped += 1
      continue
    }
    ref.current = next
    out.switched += 1
    out.chatIds.push(id)
  }
  return out
}

/** 诊断：每个聊天现在用的模型 + 是否有聊天表。 */
export function chatModelStatus(bridge) {
  const chats = liveChats(bridge)
  const rows = []
  if (chats !== null) {
    for (const [id, chat] of chats) {
      const cur = chat && chat.selectionRef ? chat.selectionRef.current : null
      rows.push({
        chatId: String(id),
        provider: cur ? String(cur.provider || '') : '',
        model: cur ? String(cur.model || '') : '',
      })
    }
  }
  return {
    ok: true,
    captured: chats !== null,
    count: rows.length,
    tracked: knownRefs.size,
    patched: globalThis[PATCHED] !== undefined,
    chats: rows,
  }
}

/** 把新选择下发给所有已知 QQ 聊天；没有聊天表时回 reason，不抛。 */
export function retargetLiveChats(bridge, next) {
  const chats = liveChats(bridge)
  if (chats === null) {
    return { ok: false, reason: knownRefs.size > 0 ? 'no-chat-registry' : 'no-chat-yet', switched: 0, skipped: 0, chatIds: [] }
  }
  return Object.assign({ ok: true }, retargetChats(chats, next))
}
