// 她的嗓子：把一句话变成声音，并且——如果能拿到音频设备——当场放出来。
// 引擎链按「免费 + 不需要 key」排序，全挂了还能退到 Windows 自带的离线语音。
//   1. edge    微软 Edge 朗读，音质最好、起伏自然（首选）
//   2. baidu   百度翻译的公开朗读接口，整句都能读，质量够用（备用）
//   3. youdao  有道词音，短句备用（长句会被它拒成 500）
//   4. sapi    Windows 自带 Huihui，离线，音色机械但永远可用
// 只在本机落盘到 $DSH_HOME/anima/voice/，不传任何账号信息。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { animaDir } from './store.js'
import { synthesizeMp3, VOICES, DEFAULT_VOICE } from './edge-tts.js'

export { VOICES }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const MAX_TEXT = 500

export function voiceDir() {
  return join(animaDir(), 'voice')
}

function stamp() {
  const d = new Date()
  const p = (n, w) => String(n).padStart(w || 2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function clip(text) {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (!raw) throw new Error('text 不能为空')
  return raw.length > MAX_TEXT ? raw.slice(0, MAX_TEXT) : raw
}

/** 长句里去掉会让公开接口直接 500 的字符（换行、制表、连续空白）。 */
function oneLine(text) {
  return text.replace(/\s+/g, ' ').trim()
}

async function fetchAudio(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://fanyi.baidu.com/' } })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const buf = Buffer.from(await res.arrayBuffer())
  // mp3 一定以 ID3 或 0xFFEx 帧头开头；返回 JSON 错误页时这两个都不成立
  const looksAudio = buf.length > 2000 && (buf[0] === 0x49 || buf[0] === 0xff)
  if (!looksAudio) throw new Error('返回的不是音频（' + buf.length + ' 字节）')
  return buf
}

async function viaEdge(text, opts) {
  const name = (opts && opts.voice) || process.env.ANIMA_VOICE || DEFAULT_VOICE
  const voice = VOICES[name] || name
  const buf = await synthesizeMp3(oneLine(text), { voice: voice })
  return { buf: buf, ext: 'mp3', engine: 'edge:' + voice }
}

async function viaBaidu(text) {
  const url = 'https://fanyi.baidu.com/gettts?lan=zh&text=' + encodeURIComponent(oneLine(text)) + '&spd=5&source=web'
  return { buf: await fetchAudio(url), ext: 'mp3', engine: 'baidu' }
}

async function viaYoudao(text) {
  const url = 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(oneLine(text)) + '&le=zh'
  return { buf: await fetchAudio(url), ext: 'mp3', engine: 'youdao' }
}

function ffplayPath() {
  const fromEnv = process.env.ANIMA_FFPLAY
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const candidates = [
    'F:/ffmpeg-temp/ffmpeg-9.0.2-essentials_build/bin/ffplay.exe',
    'C:/ffmpeg/bin/ffplay.exe',
    'C:/Program Files/ffmpeg/bin/ffplay.exe',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return 'ffplay'
}

/** Windows 自带离线合成：写 WAV。中文靠 UTF-8 文本文件传进去，避免命令行编码把字搅坏。 */
async function viaSapi(text) {
  const dir = voiceDir()
  mkdirSync(dir, { recursive: true })
  const base = join(dir, 'sapi-' + stamp())
  const txt = base + '.txt'
  const wav = base + '.wav'
  const ps1 = base + '.ps1'
  writeFileSync(txt, text, 'utf8')
  writeFileSync(ps1, [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1",
    'if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }',
    '$text = [IO.File]::ReadAllText($args[0], [Text.Encoding]::UTF8)',
    '$s.SetOutputToWaveFile($args[1])',
    '$s.Speak($text)',
    '$s.Dispose()',
  ].join('\r\n'), 'utf8')
  try {
    // SAPI 在本机常常「看得到音色、一 SelectVoice 就报没有可用语音」（安全设置/令牌问题）。
    // 所以退出码为 0 也不能算成功：必须真的产出一段有内容的 wav。
    const log = await new Promise(function (resolve, reject) {
      let out = ''
      const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, txt, wav], { windowsHide: true })
      child.stdout.on('data', function (b) { out += b.toString('utf8') })
      child.stderr.on('data', function (b) { out += b.toString('utf8') })
      child.on('error', reject)
      child.on('exit', function (code) { resolve({ code: code, out: out }) })
    })
    const size = existsSync(wav) ? readFileSync(wav).length : 0
    if (size < 1000) {
      const why = String(log.out || '').replace(/\s+/g, ' ').trim().slice(0, 160)
      throw new Error('SAPI 没出声（exit ' + log.code + (why ? '；' + why : '') + '）')
    }
    return { buf: readFileSync(wav), ext: 'wav', engine: 'sapi' }
  } finally {
    for (const f of [txt, ps1, wav]) { try { unlinkSync(f) } catch {} }
  }
}

/**
 * 目录自洁：say-* 是每次开口留下的音频，只认最近的 KEEP_VOICE 个，
 * 更早的删掉（sapi 的临时文件由 viaSapi 自己清，不在这管）。
 * 删失败不影响这次说话，静默跳过。
 */
const KEEP_VOICE = 30
function pruneVoiceDir(dir) {
  try {
    const rows = readdirSync(dir)
      .filter((name) => /^say-\d{8}-\d{6}-.+\.(mp3|wav)$/.test(name))
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const row of rows.slice(KEEP_VOICE)) {
      try { unlinkSync(join(dir, row.name)) } catch {}
    }
  } catch {}
}

/**
 * 合成一句话。
 * @param {string} text
 * @param {{engine?: string, voice?: string}} [opts] engine 传 edge / baidu / youdao / sapi 可强制指定；
 *   voice 传音色名（xiaoxiao / xiaoyi / yunxi …）或完整 Neural 名
 * @returns {Promise<{path: string, engine: string, bytes: number}>}
 */
export async function synthesize(text, opts) {
  const plain = clip(text)
  const dir = voiceDir()
  mkdirSync(dir, { recursive: true })

  const forced = opts && typeof opts.engine === 'string' ? opts.engine.trim() : ''
  const chain = [
    ['edge', viaEdge],
    ['baidu', viaBaidu],
    ['youdao', viaYoudao],
    ['sapi', viaSapi],
  ].filter(function (pair) { return !forced || pair[0] === forced })

  const failures = []
  for (const [name, fn] of chain) {
    try {
      const got = await fn(plain, opts)
      // 名字里加随机尾：同一秒合成两句时 stamp 精度不够，会互相覆盖
      const path = join(dir, 'say-' + stamp() + '-' + name + '-' + Math.random().toString(36).slice(2, 6) + '.' + got.ext)
      writeFileSync(path, got.buf)
      pruneVoiceDir(dir)
      return { path: path, engine: got.engine, bytes: got.buf.length }
    } catch (error) {
      failures.push(name + ': ' + (error && error.message ? error.message : String(error)))
    }
  }
  throw new Error('所有语音引擎都失败了（' + failures.join('；') + '）')
}

/** 放出来。播放器是独立进程，宿主退出不影响它把这一句念完。 */
export function play(path) {
  return new Promise(function (resolve, reject) {
    const bin = ffplayPath()
    const child = spawn(bin, ['-nodisp', '-autoexit', '-loglevel', 'quiet', path], { windowsHide: true, stdio: 'ignore' })
    child.on('error', reject)
    child.on('exit', function () { resolve() })
  })
}

export async function speak(text, opts) {
  const made = await synthesize(text, opts)
  const shouldPlay = !opts || opts.play !== false
  if (shouldPlay) await play(made.path)
  return made
}
