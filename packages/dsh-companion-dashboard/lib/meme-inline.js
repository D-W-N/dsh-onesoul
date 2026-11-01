/**
 * QQ 出站的表情标记配图。
 *
 * 为什么需要：dsh-meme 的 `[表情: 描述]` 标记只有它的 Web 前端会配图；IM 通道里
 * 它只是一行方括号文字（dsh-meme/index.js:11、memes.js:899 都写明这点，IM 走的是
 * dsh-im 的 dsh_im_return_file，本机没有这个通道）。而 QQ 通道（dsh-onebot-qq）的
 * 模型又常照着 dsh-meme 的默认提示词写标记，于是用户收到的是「[表情: 开心]」这种字。
 *
 * 这里在出站分句之前把标记摘出来，按 caption 在 ~/.dsh/meme-packs 的索引里找回原图，
 * 用 base64 图片段真正发出去；找不回来的标记原样保留成文字，绝不静默丢内容。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const MARKER = /\[表情\s*[:：]\s*([^\[\]]{1,80})\]/g

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** 图库根目录列表：每个子目录里有 index.db 才算一个图库（与 dsh-meme 的布局一致）。 */
export function memeDirs() {
  const root = join(dshHome(), 'meme-packs')
  let names = []
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const dirs = []
  for (const name of names) {
    const dir = join(root, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    if (existsSync(join(dir, 'index.db'))) dirs.push(dir)
  }
  return dirs
}

/**
 * 把正文里的 `[表情: 描述]` 摘出来。纯函数，方便测试。
 * @returns {{text: string, captions: string[]}}
 */
export function takeMemeMarkers(text) {
  const src = typeof text === 'string' ? text : ''
  const captions = []
  const stripped = src.replace(MARKER, (_all, raw) => {
    const caption = String(raw === undefined || raw === null ? '' : raw).trim()
    if (caption !== '') captions.push(caption)
    return ''
  })
  const cleaned = stripped
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: cleaned, captions }
}

function normalize(value) {
  return String(value === undefined || value === null ? '' : value)
    .toLowerCase()
    .replace(/[\s，。、,.!！?？~～'"“”‘’()（）[\]【】…—-]+/g, '')
}

let storeCache = { at: 0, rows: [] }

function profileDirs() {
  const root = join(dshHome(), 'profiles')
  try {
    return readdirSync(root).map((name) => join(root, name))
  } catch {
    return []
  }
}

/**
 * 找依赖里的某个文件。除了本模块自己的 node_modules，还试 dsh-onebot-qq 旁边的
 * （同装在一个 profiles 的 node_modules 里）和各 profile 的 node_modules 安装副本——
 * 仓库里的源码树没有装自己的依赖，只有 profile 里才有。
 */
function moduleFile(pkg, relative) {
  const bases = [createRequire(import.meta.url)]
  try {
    bases.push(createRequire(createRequire(import.meta.url).resolve('dsh-onebot-qq/package.json')))
  } catch {
    /* 本模块旁边没有 dsh-onebot-qq */
  }
  for (const req of bases) {
    try {
      const pkgJson = req.resolve(pkg + '/package.json')
      const file = join(pkgJson, '..', relative)
      if (existsSync(file)) return file
    } catch {
      /* 这条基址找不到 */
    }
  }
  for (const dir of profileDirs()) {
    const file = join(dir, 'node_modules', pkg, relative)
    if (existsSync(file)) return file
  }
  return null
}

async function loadMemesModule() {
  // dsh-meme 的 exports 只放行 "." / "./client" / "./package.json"，memes.js 要走 package.json 旁路
  const file = moduleFile('dsh-meme', 'memes.js')
  if (!file) return null
  try {
    return await import(pathToFileURL(file).href)
  } catch {
    /* 装了但导入失败：标记保持文字 */
  }
  return null
}

async function readRows() {
  const now = Date.now()
  if (storeCache.rows.length > 0 && now - storeCache.at < 60_000) return storeCache.rows
  const mod = await loadMemesModule()
  if (!mod || typeof mod.MemesStore !== 'function') return storeCache.rows
  const rows = []
  for (const dir of memeDirs()) {
    try {
      const store = new mod.MemesStore(dir)
      for (const row of store.rows || []) rows.push({ root: dir, row, store })
    } catch {
      /* 单个图库索引坏了不影响其它图库 */
    }
  }
  storeCache = { at: now, rows }
  return rows
}

function bigrams(text) {
  const out = new Set()
  for (let i = 0; i < text.length - 1; i += 1) out.add(text.slice(i, i + 2))
  return out
}

/**
 * 从候选里挑最像的那张。
 *
 * 图库的 caption 是「开心，咧嘴大笑心情超好」这种长句，模型抄的是候选原文 ⇒ 全等最好；
 * 但它常会截短（只写「开心」），所以按「查询被覆盖多少」打分：所有二元组都命中 = 1.0，
 * 与查询长短无关。低于 0.6 宁可退回文字，也不发一张不相干的图。
 */
function pickBest(caption, entries) {
  const want = normalize(caption)
  if (want === '' || want.length < 2) return null
  const wantBigrams = bigrams(want)
  if (wantBigrams.size === 0) return null
  let best = null
  for (const entry of entries) {
    const row = entry.row || {}
    const cap = normalize(row.caption)
    const keys = normalize(row.keywords)
    const name = normalize(row.file_name)
    let coverage = 0
    let exact = false
    for (const hay of [cap, keys, name]) {
      if (hay === '') continue
      if (hay === want) exact = true
      let common = 0
      for (const gram of wantBigrams) if (hay.includes(gram)) common += 1
      const score = common / wantBigrams.size
      if (score > coverage) coverage = score
    }
    if (coverage < 0.6) continue
    // 同分时优先全等，其次 caption 更短（更贴近查询），最后按图库顺序稳定
    const rank = (exact ? 2 : 0) + coverage
    if (best === null || rank > best.rank) best = { rank, entry }
  }
  return best === null ? null : best.entry
}

/**
 * 按描述找回图片的绝对路径。找不到返回 null（调用方把标记退回成文字）。
 * @returns {Promise<{path: string, caption: string, root: string}|null>}
 */
export async function resolveMemePath(caption) {
  const entries = await readRows()
  if (entries.length === 0) return null
  const hit = pickBest(caption, entries)
  if (!hit) return null
  const root = resolve(hit.root)
  let full
  try {
    full = resolve(root, String(hit.row.path || ''))
  } catch {
    return null
  }
  if (full !== root && !full.startsWith(root + sep)) return null
  if (!existsSync(full)) return null
  return { path: full, caption: String(hit.row.caption || caption), root }
}

async function loadMediaModule() {
  const file = moduleFile('dsh-onebot-qq', join('lib', 'media.js'))
  if (!file) return null
  try {
    return await import(pathToFileURL(file).href)
  } catch {
    return null
  }
}

/**
 * 把摘出来的描述真正发成图片消息。发不出去的退回 missed（调用方拼回文字）。
 * @returns {Promise<{sent: string[], missed: string[]}>}
 */
export async function sendMemeImages(bridge, chatId, captions, hooks = {}) {
  const sent = []
  const missed = []
  const media = await loadMediaModule()
  const roots = memeDirs().map((dir) => resolve(dir))
  for (const caption of Array.isArray(captions) ? captions : []) {
    try {
      const hit = await resolveMemePath(caption)
      if (!hit || !media || typeof media.fileToBase64 !== 'function') {
        missed.push(caption)
        continue
      }
      const file = await media.fileToBase64(hit.path, IMAGE_MAX_BYTES, roots)
      await bridge.sendMsg(chatId, [{ type: 'image', data: { file } }], {})
      sent.push(caption)
    } catch (error) {
      missed.push(caption)
      if (typeof hooks.log === 'function') {
        hooks.log('warn', 'meme image failed: ' + caption + ': ' + String(error && error.message ? error.message : error))
      }
    }
  }
  return { sent, missed }
}

/** 面板/探针用的状态。 */
export function memeInlineStatus() {
  const dirs = memeDirs()
  return {
    ok: dirs.length > 0,
    marker: true,
    packs: dirs.map((dir) => dir.split(sep).pop()),
    cached: storeCache.rows.length,
  }
}
