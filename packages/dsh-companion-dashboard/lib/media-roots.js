/**
 * QQ 出站媒体围栏：把表情包库也放行进去。
 *
 * 起因：dsh-onebot-qq/lib/bridge.js:249 mediaSendRoots() 只给两个根 —— 插件的 mediaDir
 * （默认 ~/.dsh/media/onebot），以及「管理员回合」的会话工作区（bridge.js:253-254）。
 * 表情包库在 <DSH_HOME>/meme-packs 下，两个根都不是它 ⇒ 访客回合调 qq_send_image 一律被拒：
 * 「本地路径不在允许的媒体目录内（管理员回合可另读会话工作区），或文件不存在：…」。
 * 结果是「机器人不发表情包」—— 模型要么干脆不发图，要么发图失败后沉默。
 *
 * 做法：patch ChatBridge.prototype.mediaSendRoots（bridge.js:38 导出 ChatBridge），在原结果
 * 后面追加额外的**只读**根。默认追加 <DSH_HOME>/meme-packs（存在才加），
 * 也可以在 <DSH_HOME>/companion/settings.json 里写 media.extraRoots: ["D:/some/dir"] 自行扩展。
 * 不改第三方文件 ⇒ 重装/升级 dsh-onebot-qq 后依然有效；结构变了就跳过（reason）。
 */

import { createRequire } from 'node:module'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PATCHED = Symbol.for('dsh-companion.media-roots')

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** 默认额外放行根：表情包库（dsh-meme 的库目录就是 <DSH_HOME>/meme-packs） */
function defaultRoots() {
  return [join(dshHome(), 'meme-packs')]
}

/** 用户在 companion 设置里加的根：只认绝对路径，相对路径一律忽略（避免跟着 CWD 漂） */
function configuredRoots() {
  const file = join(dshHome(), 'companion', 'settings.json')
  if (!existsSync(file)) return []
  let cfg = null
  try { cfg = JSON.parse(readFileSync(file, 'utf8')) } catch { return [] }
  const list = cfg && cfg.media && Array.isArray(cfg.media.extraRoots) ? cfg.media.extraRoots : []
  return list.filter((p) => typeof p === 'string' && p.trim() !== '' && isAbsolute(p.trim())).map((p) => p.trim())
}

function normalize(p) {
  try { return realpathSync.native(p) } catch { return p }
}

/**
 * 额外放行根（已 realpath 归一、只保留真实存在的目录）。
 * bridge 自己会把根 realpath 一遍，这里先归一避免大小写/短名差异导致前缀比对失败。
 */
export function extraMediaRoots() {
  const out = []
  for (const p of configuredRoots().concat(defaultRoots())) {
    if (!existsSync(p)) continue
    const real = normalize(p)
    if (!out.includes(real)) out.push(real)
  }
  return out
}

async function loadBridge() {
  const tries = []
  try {
    const require = createRequire(import.meta.url)
    tries.push(join(dirname(require.resolve('dsh-onebot-qq/package.json')), 'lib', 'bridge.js'))
  } catch {}
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 8; i += 1) {
    tries.push(join(dir, 'node_modules', 'dsh-onebot-qq', 'lib', 'bridge.js'))
    dir = dirname(dir)
  }
  for (const file of tries) {
    if (!existsSync(file)) continue
    try {
      const mod = await import(pathToFileURL(file).href)
      if (mod && mod.ChatBridge) return mod
    } catch {}
  }
  return null
}

export async function installMediaRoots() {
  const mod = await loadBridge()
  if (!mod) return { ok: false, reason: 'no-bridge-module' }
  const proto = mod.ChatBridge.prototype
  const original = proto.mediaSendRoots
  if (typeof original !== 'function') return { ok: false, reason: 'no-mediaSendRoots' }
  if (original[PATCHED]) return { ok: true, reason: 'already-installed', roots: extraMediaRoots() }
  const wrapped = async function mediaSendRootsWithExtras(sessionId) {
    let gate
    try { gate = await original.call(this, sessionId) } catch { gate = { roots: [], isTurnAdmin: false } }
    const base = gate && Array.isArray(gate.roots) ? gate.roots.slice() : []
    for (const root of extraMediaRoots()) if (!base.includes(root)) base.push(root)
    return Object.assign({}, gate, { roots: base })
  }
  wrapped[PATCHED] = true
  proto.mediaSendRoots = wrapped
  return { ok: true, reason: 'installed', roots: extraMediaRoots() }
}

export function mediaRootsStatus() {
  const roots = extraMediaRoots()
  return { roots: roots, count: roots.length }
}
