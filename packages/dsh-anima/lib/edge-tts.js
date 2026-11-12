// 微软 Edge 的在线朗读（免费、不需要 key、不需要登录），走的是 Edge 浏览器「大声朗读」那条服务。
// 为什么自己写：Node 自带的 WebSocket 不能带自定义请求头，而这条服务要靠 Sec-MS-GEC 头/参数过鉴权；
// 缺了它一律 403 —— 不是网络问题。令牌算法在 v2 里换成了复合串（CS64-SHA256），下面是从
// edge_tts 7.3.1 的 drm.py 逐行移植的，5 个时间点的输出与官方实现逐位一致。
import tls from 'node:tls'
import { randomBytes, randomUUID } from 'node:crypto'

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const CHROMIUM_FULL_VERSION = '143.0.3650.75'
const SEC_MS_GEC_VERSION = '2-' + CHROMIUM_FULL_VERSION
const HOST = 'speech.platform.bing.com'

/** 常用中文音色。她默认用晓晓：语气起伏最自然，小爱那种「在跟你说话」的感觉靠它。 */
export const VOICES = {
  xiaoxiao: 'zh-CN-XiaoxiaoNeural',
  xiaoyi: 'zh-CN-XiaoyiNeural',
  yunxi: 'zh-CN-YunxiNeural',
  yunjian: 'zh-CN-YunjianNeural',
  xiaobei: 'zh-CN-liaoning-XiaobeiNeural',
  xiaoni: 'zh-CN-shaanxi-XiaoniNeural',
  hiuMaan: 'zh-HK-HiuMaanNeural',
  hsiaochen: 'zh-TW-HsiaoChenNeural',
}
export const DEFAULT_VOICE = VOICES.xiaoxiao

const u32 = (x) => x >>> 0
const rotr = (x, k) => ((x >>> k) | (x << (32 - k))) >>> 0
const rol16 = (v) => ((v << 16) | (v >>> 16)) >>> 0
const mul = (a, b) => Math.imul(a, b) >>> 0

const WIN_EPOCH = 11644473600
const SHA256_INITIAL = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]
const SHA256_STATE = [0xFD9FBEA2, 0x91243CE7, 0xBE499094, 0xCD2E1E0A, 0x6C006F49, 0x04BD35AB, 0xFEB0A7E4, 0x03EFFBD2]
const SHA256_SCHEDULE = [0xEB24BF9E, 0x1558691F, 0xA0C09EE2, 0x0CFA32BA, 0xA622EE8C, 0xD1DD9491, 0xC0DD25A0, 0xF9E70AB6, 0xF0C31573, 0x7058CE4E, 0x7188E606, 0x00E5AB33, 0xD258B060, 0x72766564]
const SHA256_ROUND_CONSTANTS = [
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
]
const SHA256_ADJUSTMENT = 0xC9DC06A7
const SIGMA0_ADJUSTMENT = 0x059C0B80
const SIGMA1_ADJUSTMENT = 0x000B92C0
const CS64_COEFFICIENTS = [
  [0xE82E91B1, 0xB32700D0], [0x44DE24C6, 0x88DFF51D], [0x3BEB65BC, 0x29514038],
  [0xC89C5933, 0xB328CBDF], [0x8D1EC211, 0xD405B4D5], [0x314EF5D5, 0x26E55F3C],
  [0xE92491B1, 0x607801C6], [0xF0A5B9D5, 0x82B2C1FB], [0x06064CF3, 0xFA51A3DA],
  [0xDA79FA60, 0x207CC464], [0xBED20560, 0x3C3C74F3], [0x89F9C9F8, 0xD2D14B61],
  [0x35FA38C6, 0xBB04A2C1], [0xCB49E3C6, 0xC5626167],
]
const CS64_FACTOR = 0x82893933
const CS64_ADJUSTMENT0 = 0xF2F90B1A
const CS64_ADJUSTMENT1 = 0x0B1A0000

const sigma0 = (v) => u32((v >>> 7) ^ (v << 25) ^ (v >>> 18) ^ (v << 14) ^ (v >>> 3))
const sigma1 = (v) => u32((v >>> 17) ^ (v << 15) ^ (v >>> 19) ^ (v << 13) ^ (v >>> 10))

function wordsLe4Even(data) {
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)])
  const words = []
  for (let i = 0; i < padded.length; i += 4) words.push(padded.readUInt32LE(i))
  if (words.length % 2) words.push(0)
  return words
}

function expandSchedule(words, firstWord) {
  for (let i = firstWord || 16; i < 64; i++) {
    const x = words[i - 2]
    const y = words[i - 15]
    const s1 = (x >>> 17) ^ (x << 15) ^ (x >>> 19) ^ (x << 13) ^ (x >>> 10)
    const s0 = (y >>> 7) ^ (y << 25) ^ (y >>> 18) ^ (y << 14) ^ (y >>> 3)
    words.push(u32(s1 + words[i - 7] + s0 + words[i - 16]))
  }
}

function rounds(state, words, firstRound) {
  let [a, b, c, d, e, f, g, h] = state
  const start = firstRound || 0
  for (let i = start; i < 64; i++) {
    const k = start === 14 && i === 14 ? SHA256_ADJUSTMENT : SHA256_ROUND_CONSTANTS[i]
    const rotE = u32(rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25))
    const rotA = u32(rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22))
    const t1 = u32(h + rotE + (g ^ (e & (f ^ g))) + k + words[i])
    const t2 = u32(rotA + ((a & b) | (c & (a | b))))
    const next = u32(t1 + t2)
    const t = [next, a, b, c, u32(d + t1), e, f, g]
    ;[a, b, c, d, e, f, g, h] = t
  }
  return [a, b, c, d, e, f, g, h]
}

function sha256Init(data) {
  const words = new Array(14).fill(0)
  words.push(data.readUIntBE(0, 3))
  words.push(data.readUIntBE(3, 4))
  for (let i = 16; i < 30; i++) {
    let value = SHA256_SCHEDULE[i - 16]
    if (i - 2 >= 14) value += i === 16 ? u32(sigma1(words[i - 2]) ^ SIGMA1_ADJUSTMENT) : sigma1(words[i - 2])
    if (i - 7 >= 14) value += words[i - 7]
    if (i - 15 >= 14) value += i === 29 ? u32(sigma0(words[i - 15]) ^ SIGMA0_ADJUSTMENT) : sigma0(words[i - 15])
    words.push(u32(value))
  }
  words.push(u32(sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14] + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]))
  expandSchedule(words, 31)
  const working = rounds(SHA256_STATE, words, 14)
  return SHA256_INITIAL.map((x, i) => u32(x + working[i]))
}

function sha256Digest(data) {
  if (data.length < 7) throw new Error('令牌盐至少要 7 个字节')
  const length = 57 + data.length
  const padding = ((55 - length) % 64 + 64) % 64
  const tail = Buffer.alloc(8)
  tail.writeBigUInt64BE(BigInt(length * 8))
  const padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(padding), tail])
  let state = sha256Init(data.subarray(0, 7))
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = []
    for (let i = 0; i < 16; i++) words.push(padded.readUInt32BE(offset + i * 4))
    expandSchedule(words, 16)
    const working = rounds(state, words, 0)
    state = state.map((x, i) => u32(x + working[i]))
  }
  const out = Buffer.alloc(32)
  state.forEach((x, i) => out.writeUInt32BE(x, i * 4))
  return out
}

function cs64Digest(data, digest) {
  const keyA = u32(digest.readUInt32LE(0) | 1)
  const keyB = u32(digest.readUInt32LE(4) | 1)
  const factors = [mul(keyA, CS64_FACTOR), mul(keyB, CS64_FACTOR)]
  const terms = CS64_COEFFICIENTS.map(([coefficient], i) => mul(coefficient, factors[i % 2]))
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset)
  wordsLe4Even(Buffer.concat([Buffer.from([0]), data])).forEach((word, i) => {
    let term = mul(word, i % 2 === 0 ? keyA : keyB)
    let offset = mul(rol16(word), i % 2 === 0 ? 0xEF0569FB : 0xC31713DB)
    if (i === 0) {
      term = u32(term + mul(CS64_ADJUSTMENT0, factors[0]))
      offset = u32(offset + CS64_ADJUSTMENT1)
    }
    terms.push(term)
    offsets.push(offset)
  })
  let swapAcc = 0
  let swapLast = 0
  let state = 0
  let acc = 0
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i]
    const y = terms[i + 1]
    let t = rol16(u32(offsets[i] + x))
    let q = mul(t, 0x76F50F34)
    swapAcc = u32(swapAcc + u32(mul(rol16(q), 0xC3EFEA97) + q))
    t = rol16(u32(offsets[i + 1] + y))
    q = mul(t, 0x1881CE3C)
    swapLast = u32(mul(rol16(q), 0x35BD1EC9) + q)
    swapAcc = u32(swapAcc + swapLast)
    state = u32(mul(state, keyA) + x)
    state = mul(rol16(state), 0xCF98B111)
    state = mul(rol16(state), 0x87085B9F)
    state = mul(rol16(state), 0x12CEB96D)
    state = mul(rol16(state), 0x257E1D83)
    acc = u32(acc + state)
    t = u32(mul(state, keyB) + y)
    t = mul(rol16(t), 0xA27416F5)
    t = mul(rol16(t), 0xD38396FF)
    state = mul(rol16(mul(rol16(t), 0x7C932B89)), 0xBFA49F69)
    acc = u32(acc + state)
  }
  return [u32(swapLast ^ state), u32(swapAcc ^ acc)]
}

/** Sec-MS-GEC 令牌。窗口是 5 分钟，所以同一个窗口内可复用。 */
export function secMsGec(unixTimestamp) {
  let ticks = (unixTimestamp === undefined ? Date.now() / 1000 : unixTimestamp) + WIN_EPOCH
  ticks -= ticks % 300
  ticks *= 1e7
  const strToHash = Buffer.from(`${Math.round(ticks)}${TOKEN}`, 'ascii')
  const digest = sha256Digest(strToHash)
  const [hi, lo] = cs64Digest(strToHash, digest)
  const head = Buffer.alloc(8)
  head.writeUInt32LE(hi, 0)
  head.writeUInt32LE(lo, 4)
  return `${head.toString('hex').toUpperCase()}-${digest.toString('hex').toUpperCase()}`
}

function httpDate() {
  return new Date().toUTCString()
}

function maskFrame(payload, opcode) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8')
  const mask = randomBytes(4)
  let header
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, 0x80 | data.length])
  } else if (data.length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 126
    header.writeUInt16BE(data.length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(data.length), 2)
  }
  const masked = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4]
  return Buffer.concat([header, mask, masked])
}

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]))
}

/**
 * 合成一句话，返回 mp3 字节。
 * @param {string} text
 * @param {{voice?: string, rate?: string, pitch?: string, volume?: string, timeoutMs?: number}} [opts]
 */
export function synthesizeMp3(text, opts) {
  const options = opts || {}
  const voice = options.voice || DEFAULT_VOICE
  const rate = options.rate || '+0%'
  const pitch = options.pitch || '+0Hz'
  const volume = options.volume || '+0%'
  const timeoutMs = options.timeoutMs || 25000

  return new Promise(function (resolve, reject) {
    const path = '/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=' + TOKEN
      + '&ConnectionId=' + randomUUID().replace(/-/g, '')
      + '&Sec-MS-GEC=' + encodeURIComponent(secMsGec())
      + '&Sec-MS-GEC-Version=' + encodeURIComponent(SEC_MS_GEC_VERSION)
    const sock = tls.connect({ host: HOST, port: 443, servername: HOST })
    const audio = []
    let buf = Buffer.alloc(0)
    let handshaken = false
    let done = false
    let frameOpcode = 0
    let frameParts = []

    const timer = setTimeout(function () { fail(new Error('合成超时（' + timeoutMs + 'ms）')) }, timeoutMs)

    function fail(error) {
      if (done) return
      done = true
      clearTimeout(timer)
      try { sock.destroy() } catch {}
      reject(error)
    }

    function succeed() {
      if (done) return
      done = true
      clearTimeout(timer)
      try { sock.destroy() } catch {}
      const out = Buffer.concat(audio)
      if (!out.length) return reject(new Error('服务端没有返回音频（音色名可能不对）'))
      resolve(out)
    }

    function send(headers, body) {
      sock.write(maskFrame('X-Timestamp:' + httpDate() + '\r\n' + headers + '\r\n\r\n' + body, 0x1))
    }

    function startSynth() {
      send('Content-Type:application/json; charset=utf-8\r\nPath:speech.config',
        JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' }, outputFormat: 'audio-24khz-48kbitrate-mono-mp3' } } } }))
      const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='"
        + voice + "'><prosody pitch='" + pitch + "' rate='" + rate + "' volume='" + volume + "'>"
        + escapeXml(text) + '</prosody></voice></speak>'
      send('Content-Type:application/ssml+xml\r\nPath:ssml\r\nX-RequestId:' + randomUUID().replace(/-/g, ''), ssml)
    }

    function handleMessage(payload, opcode) {
      if (opcode === 0x1) {
        if (payload.toString('utf8').includes('Path:turn.end')) succeed()
        return
      }
      if (opcode === 0x2) {
        const headerLen = payload.readUInt16BE(0)
        const head = payload.subarray(2, 2 + headerLen).toString('utf8')
        if (head.includes('Path:audio')) audio.push(payload.subarray(2 + headerLen))
      }
    }

    function drain() {
      while (buf.length >= 2) {
        const b0 = buf[0]
        const b1 = buf[1]
        const fin = (b0 & 0x80) !== 0
        const opcode = b0 & 0x0f
        let len = b1 & 0x7f
        let off = 2
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
        if (buf.length < off + len) return
        const payload = buf.subarray(off, off + len)
        buf = buf.subarray(off + len)
        if (opcode === 0x8) { succeed(); return }
        if (opcode === 0x9) { sock.write(maskFrame(payload, 0xa)); continue }
        if (opcode === 0xa) continue
        if (opcode === 0x0) {
          frameParts.push(payload)
          if (fin) {
            const whole = Buffer.concat(frameParts)
            const kind = frameOpcode
            frameParts = []
            frameOpcode = 0
            handleMessage(whole, kind)
          }
          continue
        }
        if (!fin) {
          frameOpcode = opcode
          frameParts = [payload]
          continue
        }
        handleMessage(payload, opcode)
      }
    }

    sock.on('secureConnect', function () {
      sock.write([
        'GET ' + path + ' HTTP/1.1',
        'Host: ' + HOST,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: ' + randomBytes(16).toString('base64'),
        'Sec-WebSocket-Version: 13',
        'Pragma: no-cache',
        'Cache-Control: no-cache',
        'Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'
          + CHROMIUM_FULL_VERSION.split('.')[0] + '.0.0.0 Safari/537.36 Edg/' + CHROMIUM_FULL_VERSION.split('.')[0] + '.0.0.0',
        'Accept-Language: zh-CN,zh;q=0.9',
        'Cookie: muid=' + randomBytes(16).toString('hex').toUpperCase() + ';',
        '', '',
      ].join('\r\n'))
    })

    sock.on('data', function (chunk) {
      if (!handshaken) {
        buf = Buffer.concat([buf, chunk])
        const idx = buf.indexOf('\r\n\r\n')
        if (idx < 0) return
        const head = buf.subarray(0, idx).toString('utf8')
        const status = head.split('\r\n')[0]
        if (!/ 101 /.test(status)) {
          const detail = head.split('\r\n').slice(1, 4).join(' | ')
          return fail(new Error('握手被拒：' + status + (detail ? '（' + detail + '）' : '')))
        }
        handshaken = true
        buf = buf.subarray(idx + 4)
        startSynth()
        drain()
        return
      }
      buf = Buffer.concat([buf, chunk])
      drain()
    })

    sock.on('error', function (e) { fail(e) })
    sock.on('close', function () { if (!done) fail(new Error('连接在拿到音频之前关了')) })
  })
}
