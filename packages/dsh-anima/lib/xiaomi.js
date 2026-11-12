// 小米账号登录 + MiNA（小爱音箱）控制。从 miservice 的 miaccount.py / minaservice.py 移植。
// 只用 node 内置模块：不引第三方依赖，也不把密码留在任何地方（登录脚本拿到的是 serviceToken）。
// 所有 HTTP 都过 transport()：测试时整体换掉它就能脱网验证协议形状。
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { request as httpsRequest } from 'node:https'
import { dshHome } from './store.js'

export const ACCOUNT_BASE = 'https://account.xiaomi.com'
export const MINA_BASE = 'https://api2.mina.mi.com'
export const TOKEN_PATH = join(dshHome(), 'anima', 'mi.json')

// account.xiaomi.com 的 JSON 前面带了这一串，不剥掉 JSON.parse 直接失败
const JSON_PREFIX = '&&&START&&&'

const UA_LOGIN = 'APP/com.xiaomi.mihome APPV/11.3.203 iosPassportSDK/4.2.50 iOS/26.3.1 MK/aVBob25lMTcsMg== DEVT/aVBob25l DEVS/aU9T BRA/QXBwbGU= L/zh_CN'
const UA_OTP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 iOS/26.3.1 MiHome/11.3.203 iPhone/iPhone17,2 DeviceId/D84D9205859533D504042022029B988E6F7DD180 UserId/8816080 APP/com.xiaomi.mihome APPV/11.3.203 Platform/iPhone Region/CN /xiaomi/miuibrowser/4.3/smartHome/ios/iPhone17,2/11.3.203 APP/com.xiaomi.mihome APPV/11.3.203 iosPassportSDK/4.2.50 iOS/26.3.1 MK/aVBob25lMTcsMg== DEVT/aVBob25l DEVS/aU9T BRA/QXBwbGU= L/zh_CN'
const UA_MINA = 'MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; iOS 14.4.0) Alamofire/6.0.103 MICO/iOSApp/appStore/6.0.103'

// 这些型号的固件不认 player_play_url，只认 player_play_music（照 minaservice.py 抄）
const USE_PLAY_MUSIC = new Set(['LX04', 'LX05', 'L05B', 'L05C', 'L06', 'L06A', 'X08A', 'X10A', 'X08C', 'X08E', 'X8F', 'X4B', 'OH2', 'OH2P', 'X6A'])

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function randomStr(length) {
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) out += ALNUM[bytes[i] % ALNUM.length]
  return out
}

function stripPrefix(text) {
  const raw = String(text == null ? '' : text)
  return raw.startsWith(JSON_PREFIX) ? raw.slice(JSON_PREFIX.length) : raw
}

/** 解析带 &&&START&&& 前缀的响应体；空体当 {}。 */
export function parseJsonText(text) {
  const raw = stripPrefix(text).trim()
  if (!raw) return {}
  const json = JSON.parse(raw)
  // nonce 是 19 位整数，超过 JS 的安全整数范围，JSON.parse 会把它四舍五入掉；
  // clientSign 就是 sha1('nonce=<nonce>&<ssecurity>')，差一位就 401。所以从原文把字符串抠出来。
  if (json && typeof json === 'object' && 'nonce' in json) {
    const hit = /"nonce"\s*:\s*"?(\d{10,})"?/.exec(raw)
    if (hit) json.nonce = hit[1]
  }
  return json
}

// ---- 唯一的出口：换掉它就能在测试里脱网 ----

function defaultTransport(opts) {
  return new Promise(function (resolve, reject) {
    const url = new URL(opts.url)
    const headers = Object.assign({}, opts.headers)
    if (opts.body != null) headers['Content-Length'] = Buffer.byteLength(opts.body)
    const req = httpsRequest({
      method: opts.method || 'GET',
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      headers: headers,
      timeout: opts.timeoutMs || 15000,
    }, function (res) {
      const chunks = []
      res.on('data', function (chunk) { chunks.push(chunk) })
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
      })
    })
    req.on('timeout', function () { req.destroy(new Error('请求超时：' + opts.url)) })
    req.on('error', reject)
    if (opts.body != null) req.write(opts.body)
    req.end()
  })
}

let transport = defaultTransport

// ---- 排错用：把每一步请求的形状记下来（凭证打码），只在 --debug 时开 ----
let tracing = false
const debugTrace = []

export function debugEnabled(on) {
  tracing = on === true
  debugTrace.length = 0
}

export function debugDump() {
  return debugTrace.slice()
}

function maskSecrets(text) {
  return String(text == null ? '' : text).replace(
    /(ticket|clientSign|passToken|ssecurity|serviceToken|_sign|cUserId|userId)=([^&\s"]{4})[^&\s"]*/g,
    function (all, key, head) { return key + '=' + head + '…' }
  )
}

/** 测试钩子：传 null 复位。 */
export function __setTransport(fn) {
  transport = typeof fn === 'function' ? fn : defaultTransport
}

function cookieHeader(cookies) {
  return Object.keys(cookies || {})
    .filter(function (key) { return cookies[key] !== undefined && cookies[key] !== null && cookies[key] !== '' })
    .map(function (key) { return key + '=' + String(cookies[key]) })
    .join('; ')
}

function cookiesOf(headers) {
  const raw = headers && (headers['set-cookie'] || headers['Set-Cookie'])
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : [])
  const out = {}
  for (const line of list) {
    const pair = String(line).split(';')[0]
    const at = pair.indexOf('=')
    if (at <= 0) continue
    out[pair.slice(0, at).trim()] = pair.slice(at + 1).trim()
  }
  return out
}

/**
 * 发一次请求并解析。form 走 x-www-form-urlencoded，body 走 JSON；jar 用来留住会话 cookie
 * （小米的 OTP 流程靠这一串 cookie 把「已验证」的状态带到最后一步）。
 */
async function requestJson(opts) {
  const headers = Object.assign({}, opts.headers)
  let body = null
  if (opts.form) {
    body = new URLSearchParams(opts.form).toString()
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
  } else if (opts.body !== undefined) {
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
    headers['Content-Type'] = 'application/json; charset=utf-8'
  }
  const jar = opts.jar || null
  const merged = Object.assign({}, jar || {}, opts.cookies || {})
  const cookies = cookieHeader(merged)
  if (cookies) headers.Cookie = cookies
  const res = await transport({ method: opts.method || 'GET', url: opts.url, headers: headers, body: body, timeoutMs: opts.timeoutMs })
  const got = cookiesOf(res.headers)
  if (jar) Object.assign(jar, got)
  if (tracing) {
    let head = ''
    try {
      const rawBody = res.body == null ? '' : (Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body))
      head = rawBody.slice(0, 200)
    } catch (error) { head = '' }
    debugTrace.push({
      method: opts.method || 'GET',
      url: maskSecrets(String(opts.url).slice(0, 320)),
      status: res.status,
      sentCookies: Object.keys(merged || {}),
      gotCookies: Object.keys(got || {}),
      redirect: res.headers && res.headers.location ? maskSecrets(String(res.headers.location)) : '',
      bodyHead: maskSecrets(head),
    })
  }
  const text = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body == null ? '' : res.body)
  let json = null
  try {
    json = parseJsonText(text)
  } catch (error) {
    json = null
  }
  return { status: res.status, headers: res.headers, text: text, json: json, cookies: Object.assign({}, got) }
}

// ---- token 落盘 ----

export function loadToken(path) {
  try {
    const raw = readFileSync(path || TOKEN_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch (error) {
    return null
  }
}

export function saveToken(token, path) {
  const target = path || TOKEN_PATH
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(token, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  // Windows 上 chmod 基本是空操作，失败了也不算错
  try { chmodSync(target, 0o600) } catch (error) { /* 忽略 */ }
  return target
}

// ---- 登录 ----

function hashPassword(password) {
  return createHash('md5').update(String(password), 'utf8').digest('hex').toUpperCase()
}

const LOGIN_ERRORS = {
  70016: '账号或密码不对',
  87001: '需要图形验证码（先在手机上登录一次这个账号，再重试）',
  21300: '需要手机验证码',
  22003: '账号触发了安全验证，请先在手机上确认登录',
}

function loginError(resp) {
  const code = Number(resp && resp.code)
  const desc = String((resp && (resp.desc || resp.description || resp.message)) || '')
  const known = LOGIN_ERRORS[code]
  const error = new Error('登录失败' + (known ? '：' + known : '') + '（code ' + code + (desc ? '；' + desc : '') + '）')
  error.miCode = code
  error.miDesc = desc
  return error
}

function networkError(error) {
  const code = String((error && error.code) || '')
  if (!code) return error
  const netCodes = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH']
  if (netCodes.indexOf(code) < 0 && !String(error.message || '').includes('超时')) return error
  const wrapped = new Error('网络不通，连不上小米服务器（' + code + '）：' + String(error.message || ''))
  wrapped.cause = error
  return wrapped
}

async function serviceLoginRequest(token, uri, form, jar) {
  const headers = { 'User-Agent': UA_LOGIN }
  const cookies = { sdkVersion: '3.9', deviceId: token.deviceId }
  if (token.userId && token.passToken) {
    cookies.userId = token.userId
    cookies.passToken = token.passToken
  }
  const res = await requestJson({
    method: form ? 'POST' : 'GET',
    url: ACCOUNT_BASE + '/pass/' + uri,
    headers: headers,
    cookies: cookies,
    form: form,
    jar: jar,
  })
  return res.json || {}
}

function sessionCookies(token) {
  const out = { deviceId: token.deviceId }
  if (token.userId) out.userId = token.userId
  if (token.passToken) out.passToken = token.passToken
  return out
}

async function securityTokenService(location, nonce, ssecurity, cookies, sharedJar) {
  const clientSign = createHash('sha1').update('nonce=' + nonce + '&' + ssecurity, 'utf8').digest('base64')
  // 斜杠必须原样发出去：python 那边是 parse.quote(sign)（safe='/'），把 / 编成 %2F 会被 sts 判 401（实测）
  const quotedSign = encodeURIComponent(clientSign).replace(/%2F/g, '/')
  let url = String(location) + (String(location).indexOf('?') >= 0 ? '&' : '?') + 'clientSign=' + quotedSign
  // python 那边是带 cookie 的 session：整轮登录里所有响应落下的 cookie 都会自动带上，这里照做
  const jar = sharedJar || {}
  Object.assign(jar, cookies || {})
  let lastText = ''
  let lastStatus = 0
  // sts 这一步常常先回 302，serviceToken 在跳转链上才落下来；不跟跳转就会拿到空 body
  for (let hop = 0; hop < 5; hop++) {
    const res = await requestJson({ url: url, headers: { 'User-Agent': UA_LOGIN }, jar: jar })
    const tokenCookie = (res.cookies && res.cookies.serviceToken) || jar.serviceToken
    if (tokenCookie) return tokenCookie
    lastStatus = res.status
    lastText = String(res.text || '').slice(0, 200)
    const loc = res.headers && (res.headers.location || res.headers.Location)
    if (!loc) break
    url = String(loc).startsWith('http') ? String(loc) : new URL(String(loc), url).toString()
  }
  throw new Error('拿不到 serviceToken（HTTP ' + lastStatus + (lastText ? '；回应：' + lastText : '；既没 cookie 也没跳转') + '）')
}

async function verifyOtp(args) {
  const token = args.token
  const sid = args.sid
  const otpCallback = args.otpCallback
  const jar = args.jar
  if (typeof otpCallback !== 'function') {
    throw new Error('这个账号要短信/邮箱验证码，但没有可用的 otpCallback（用 scripts/mi-login.mjs 跑就能交互输入）')
  }
  const ntfUrl = args.ntf.startsWith('http') ? args.ntf : ACCOUNT_BASE + args.ntf
  const headers = { 'User-Agent': UA_OTP }
  const cookies = { deviceId: token.deviceId }

  // 1. 先打开验证会话，拿到这一轮的 cookie
  await requestJson({ url: ntfUrl, headers: headers, cookies: cookies, jar: jar })

  // 2. 查可用验证方式：flag 4=手机, 8=邮箱
  const parsed = new URL(ntfUrl)
  const context = parsed.searchParams.get('context') || ''
  const sidParam = parsed.searchParams.get('sid') || sid
  const listRes = await requestJson({
    url: ACCOUNT_BASE + '/identity/list?sid=' + encodeURIComponent(sidParam) + '&supportedMask=0&_locale=zh_CN&context=' + encodeURIComponent(context),
    headers: headers,
    cookies: cookies,
    jar: jar,
  })
  const idata = listRes.json || {}
  const flag = idata.flag === undefined || idata.flag === null ? 4 : Number(idata.flag)
  const method = flag === 8 ? 'Email' : 'Phone'

  // 3. 触发下发
  const triggerRes = await requestJson({
    url: ACCOUNT_BASE + '/identity/auth/verify' + method + '?_flag=' + flag + '&_json=true',
    headers: headers,
    cookies: cookies,
    jar: jar,
  })
  const tresp = triggerRes.json || {}
  if (tresp.code !== undefined && Number(tresp.code) !== 0) {
    throw new Error('触发验证码下发失败：' + JSON.stringify(tresp).slice(0, 300))
  }

  // 4. 手机号还得多打一次 sendPhoneTicket 才算真发出去
  if (method === 'Phone') {
    const sendRes = await requestJson({
      method: 'POST',
      url: ACCOUNT_BASE + '/identity/auth/sendPhoneTicket',
      form: { retry: '0', icode: '', _json: 'true' },
      headers: headers,
      cookies: cookies,
      jar: jar,
    })
    const sresp = sendRes.json || {}
    if (sresp.code !== undefined && Number(sresp.code) !== 0) {
      throw new Error('发送短信验证码失败：' + JSON.stringify(sresp).slice(0, 300))
    }
  }

  // 5. 等人把验证码输进来
  const code = await otpCallback(method)
  if (!code) throw new Error('没拿到验证码')

  // 6. 提交验证码
  const verifyRes = await requestJson({
    method: 'POST',
    url: ACCOUNT_BASE + '/identity/auth/verify' + method + '?_dc=' + Date.now(),
    form: { _flag: String(flag), ticket: String(code).trim(), trust: 'false', _json: 'true' },
    headers: headers,
    cookies: cookies,
    jar: jar,
  })
  const vresp = verifyRes.json || {}
  let location = vresp.location
  if (!location) throw new Error('验证码没被接受：' + JSON.stringify(vresp).slice(0, 300))
  if (!String(location).startsWith('http')) location = ACCOUNT_BASE + location

  // 7. 跟着 location 把 cookie 落地，再重做一次 serviceLogin
  await requestJson({ url: location, headers: headers, cookies: cookies, jar: jar })
  const resp = await serviceLoginRequest(token, 'serviceLogin?sid=' + encodeURIComponent(sid) + '&_json=true', null, jar)
  if (Number(resp.code) !== 0) throw new Error('验证码过了但登录没接上：' + JSON.stringify(resp).slice(0, 300))
  return resp
}

/**
 * 账号密码登录，拿到 { deviceId, userId, passToken, micoapi: [ssecurity, serviceToken] }。
 * 需要验证码时通过 otpCallback(method) 要验证码（method 是 'Phone' 或 'Email'）。
 */
export async function login(options) {
  const opts = options || {}
  const username = String(opts.username || '').trim()
  const password = String(opts.password || '')
  const sid = String(opts.sid || 'micoapi')
  if (!username || !password) throw new Error('需要小米账号（手机号/邮箱）和密码')
  const token = { deviceId: randomStr(16).toUpperCase() }
  const jar = {}
  try {
    let resp = await serviceLoginRequest(token, 'serviceLogin?sid=' + encodeURIComponent(sid) + '&_json=true', null, jar)
    if (Number(resp.code) !== 0) {
      const form = {
        _json: 'true',
        qs: resp.qs,
        sid: resp.sid,
        _sign: resp._sign,
        callback: resp.callback,
        user: username,
        hash: hashPassword(password),
      }
      resp = await serviceLoginRequest(token, 'serviceLoginAuth2', form, jar)
      if (Number(resp.code) !== 0) throw loginError(resp)
      if (resp.notificationUrl) {
        resp = await verifyOtp({ token: token, sid: sid, ntf: String(resp.notificationUrl), otpCallback: opts.otpCallback, jar: jar })
      }
    }
    for (const key of ['userId', 'passToken', 'location', 'nonce', 'ssecurity']) {
      if (resp[key] === undefined || resp[key] === null || resp[key] === '') {
        throw new Error("登录响应缺少 '" + key + "'：" + JSON.stringify(resp).slice(0, 300))
      }
    }
    token.userId = resp.userId
    token.passToken = resp.passToken
    token[sid] = [resp.ssecurity, await securityTokenService(String(resp.location), resp.nonce, resp.ssecurity, sessionCookies(token), jar)]
    saveToken(token, opts.out)
    return token
  } catch (error) {
    throw networkError(error)
  }
}

/** 把二维码地址下载成 PNG 字节，交给调用方落盘。 */
export async function fetchQrImage(qrUrl) {
  const res = await transport({ method: 'GET', url: String(qrUrl), headers: { 'User-Agent': UA_LOGIN } })
  const body = res && res.body
  if (!Buffer.isBuffer(body) || body.length < 200) throw new Error('二维码图片没拿到（' + (res && res.status) + '）')
  return body
}

/**
 * 扫码登录：走 longPolling 那条路，完全绕开发短信验证码。
 * 密码登录被「用户行为被限制」（code 20024）拦死时的备用入口。
 * onQr(qrUrl, info) 由调用方把二维码存成图片给用户扫；onWait() 表示长轮询开始了。
 */
export async function qrLogin(options) {
  const opts = options || {}
  const sid = String(opts.sid || 'micoapi')
  // 有旧 deviceId 就沿用：老换新设备在小米那边就是「异常登录」的信号
  const token = { deviceId: String(opts.deviceId || "") || randomStr(16).toUpperCase() }
  try {
    const start = await requestJson({
      url: ACCOUNT_BASE + '/longPolling/loginUrl?sid=' + encodeURIComponent(sid) + '&_json=true&_locale=zh_CN',
      headers: { 'User-Agent': UA_LOGIN },
    })
    const info = start.json || {}
    if (!info.qr || !info.lp) {
      throw new Error('拿二维码失败（code ' + (info.code === undefined ? '?' : info.code) + '）：' + String(start.text || '').slice(0, 200))
    }
    if (typeof opts.onQr === 'function') await opts.onQr(String(info.qr), info)
    if (typeof opts.onWait === 'function') await opts.onWait(info)

    const waitMs = Math.max(30, Number(info.timeout) || 300) * 1000
    const jar = {}
    const poll = await requestJson({ url: String(info.lp), headers: { 'User-Agent': UA_LOGIN }, jar: jar, timeoutMs: waitMs })
    const body = poll.json || {}
    // 扫码确认之后，会话凭据有的在 body 里、有的只在 Set-Cookie 里，两处都捞
    const userId = body.userId || jar.userId || ''
    const passToken = body.passToken || jar.passToken || ''
    if (!userId || !passToken) {
      throw new Error('二维码没扫成（lp 没给 userId/passToken）：' + JSON.stringify(body).slice(0, 200))
    }
    token.userId = userId
    token.passToken = passToken
    // 先把「只有 passToken」这一份落盘：万一后面换 serviceToken 失败，也不用重新扫码
    saveToken(token, opts.out)

    // 拿到 passToken 之后就能走「免密续登」那一步，向 micoapi 换 serviceToken
    const resp = await serviceLoginRequest(token, 'serviceLogin?sid=' + encodeURIComponent(sid) + '&_json=true', null, jar)
    if (Number(resp.code) !== 0 || !resp.location || !resp.ssecurity) {
      throw new Error('扫码后换 serviceToken 失败（code ' + (resp.code === undefined ? '?' : resp.code) + '）：' + JSON.stringify(resp).slice(0, 200))
    }
    if (resp.userId) token.userId = resp.userId
    if (resp.passToken) token.passToken = resp.passToken
    token[sid] = [resp.ssecurity, await securityTokenService(String(resp.location), resp.nonce, resp.ssecurity, sessionCookies(token), jar)]
    saveToken(token, opts.out)
    return token
  } catch (error) {
    const message = String((error && error.message) || '')
    if (message.includes('请求超时') || message.includes('超时')) {
      throw new Error('二维码超时了（一直没扫到或者扫完没在手机上点确认）：重跑一次')
    }
    throw networkError(error)
  }
}

/** 用手工从浏览器拷来的 userId / passToken 换 serviceToken：不碰密码、不碰短信、不扫码。 */
export async function loginWithPassToken(options) {
  const opts = options || {}
  const userId = String(opts.userId || '').trim()
  const passToken = String(opts.passToken || '').trim()
  if (!userId || !passToken) throw new Error('需要 userId 和 passToken 两个 cookie')
  const token = { deviceId: String(opts.deviceId || '') || randomStr(16).toUpperCase(), userId: userId, passToken: passToken }
  saveToken(token, opts.out)
  return await reloginByPassToken(token, opts.out || TOKEN_PATH)
}

/** 用 token 里的 passToken 续一次（不扫码、不输密码）：落盘里缺 micoapi 时补上。 */
export async function refreshToken(token, options) {
  const saved = token || loadToken((options && options.out) || TOKEN_PATH)
  if (!saved) throw new Error('没有 token 文件，先跑 scripts/mi-login.mjs')
  return await reloginByPassToken(saved, (options && options.out) || TOKEN_PATH)
}

/** 401 时用 passToken 续一次：这条路不需要密码，也是 py 里 mi_request 的重登逻辑。 */
async function reloginByPassToken(token, out) {
  if (!token || !token.userId || !token.passToken) {
    throw new Error('token 里没有 passToken，得重新跑 scripts/mi-login.mjs 登录')
  }
  const jar = {}
  const resp = await serviceLoginRequest(token, 'serviceLogin?sid=micoapi&_json=true', null, jar)
  if (Number(resp.code) !== 0 || !resp.location || !resp.ssecurity) {
    throw new Error('用 passToken 续登失败（code ' + resp.code + '），得重新跑 scripts/mi-login.mjs 登录')
  }
  token.micoapi = [resp.ssecurity, await securityTokenService(String(resp.location), resp.nonce, resp.ssecurity, sessionCookies(token), jar)]
  if (resp.userId) token.userId = resp.userId
  if (resp.passToken) token.passToken = resp.passToken
  saveToken(token, out || TOKEN_PATH)
  return token
}

async function authorizedRequest(token, url, body, relogin) {
  const isForm = body !== undefined && typeof body === 'object'
  const res = await requestJson({
    method: body === undefined ? 'GET' : 'POST',
    url: url,
    headers: { 'User-Agent': UA_MINA },
    cookies: { userId: token.userId, serviceToken: (token.micoapi || [])[1] },
    form: isForm ? body : undefined,
    body: isForm ? undefined : body,
  })
  if (res.status === 200 && res.json && Number(res.json.code) === 0) return res.json
  const message = String((res.json && res.json.message) || '').toLowerCase()
  const authFailed = res.status === 401 || message.includes('auth')
  if (authFailed && relogin !== false) {
    await reloginByPassToken(token)
    return await authorizedRequest(token, url, body, false)
  }
  if (authFailed) throw new Error('认证失败（HTTP ' + res.status + '），得重新跑 scripts/mi-login.mjs 登录')
  const code = res.json ? res.json.code : '?'
  throw new Error('MiNA 请求失败（code ' + code + '）：' + String(res.text || '').slice(0, 300))
}

async function minaRequest(token, uri, data) {
  const requestId = 'app_ios_' + randomStr(30)
  let url = MINA_BASE + uri
  let body
  if (data !== undefined && data !== null) {
    data.requestId = requestId
    // MiNA 的 /remote/ubus 收的是表单（python 那边 aiohttp data=dict 就是 x-www-form-urlencoded），
    // 发 JSON 会被判 illegal argument：Required request parameter 'deviceId' ... is not present
    body = data
  } else {
    url += (uri.indexOf('?') >= 0 ? '&' : '?') + 'requestId=' + requestId
  }
  return await authorizedRequest(token, url, body, true)
}

// ---- 设备与 ubus ----

const hardwareCache = new Map()
const HARDWARE_TTL = 10 * 60 * 1000

function rememberDevices(rows) {
  for (const row of rows || []) {
    if (row && row.deviceID) hardwareCache.set(row.deviceID, { hardware: row.hardware || '', at: Date.now() })
  }
}

// 设备列表短时缓存：耳朵每 3 秒轮询一次，每条都先打 device_list 等于每 3 秒
// 敲一次小米的管理接口 —— 这正是触发风控的姿势（NapCat 就是前车之鉴）。
// 设备基本不变，60 秒内的答案直接复用；force=true 可越过去刷新。
let deviceCache = { at: 0, rows: null }
const DEVICE_TTL = 60 * 1000

export async function deviceList(token, options) {
  const force = options && options.force === true
  if (!force && deviceCache.rows && Date.now() - deviceCache.at < DEVICE_TTL) {
    rememberDevices(deviceCache.rows)
    return deviceCache.rows
  }
  const resp = await minaRequest(token, '/admin/v2/device_list?master=0', undefined)
  const rows = Array.isArray(resp.data) ? resp.data : []
  const out = rows.map(function (row) {
    return {
      deviceID: row.deviceID || '',
      name: row.name || '',
      hardware: row.hardware || '',
      capabilities: row.capabilities && typeof row.capabilities === 'object' ? row.capabilities : {},
    }
  })
  rememberDevices(out)
  deviceCache = { at: Date.now(), rows: out }
  return out
}

async function hardwareOf(token, deviceId) {
  const hit = hardwareCache.get(deviceId)
  if (hit && Date.now() - hit.at < HARDWARE_TTL) return hit.hardware
  try {
    await deviceList(token)
  } catch (error) {
    return hit ? hit.hardware : ''
  }
  const again = hardwareCache.get(deviceId)
  return again ? again.hardware : ''
}

async function ubusRequest(token, deviceId, method, path, message) {
  const resp = await minaRequest(token, '/remote/ubus', {
    deviceId: deviceId,
    message: JSON.stringify(message || {}),
    method: method,
    path: path,
  })
  return resp
}

async function ubus(token, deviceId, method, path, message) {
  const resp = await ubusRequest(token, deviceId, method, path, message)
  return Boolean(resp && Number(resp.code) === 0)
}

/** 音箱自己的音色念一句（音色是音箱的，不是她的，只在拉不动 URL 时兜底）。 */
export async function textToSpeech(token, deviceId, text) {
  return await ubus(token, deviceId, 'text_to_speech', 'mibrain', { text: String(text == null ? '' : text) })
}

export async function setVolume(token, deviceId, volume) {
  return await ubus(token, deviceId, 'player_set_volume', 'mediaplayer', { volume: Number(volume), media: 'app_ios' })
}

/**
 * 关掉循环：小爱的播放器默认把「只有一条的列表」当循环列表反复放。
 * 老固件（player_play_url）认这个开关；新固件的循环由 play_behavior 决定，所以还要配合 playerStop 兜底。
 */
export async function setLoopOff(token, deviceId) {
  return await ubus(token, deviceId, 'player_set_loop', 'mediaplayer', { media: 'common', type: 0 })
}

/** 喊停：她说完就闭嘴，别让音箱自己接着循环。 */
export async function playerStop(token, deviceId) {
  return await ubus(token, deviceId, 'player_play_operation', 'mediaplayer', { action: 'stop', media: 'app_ios' })
}

async function playByMusicUrl(token, deviceId, url) {
  const audioId = '1582971365183456177'
  const music = {
    payload: {
      audio_type: '',
      audio_items: [
        {
          item_id: {
            audio_id: audioId,
            cp: { album_id: '-1', episode_index: 0, id: '355454500', name: 'xiaowei' },
          },
          stream: { url: url },
        },
      ],
      list_params: { listId: '-1', loadmore_offset: 0, origin: 'xiaowei', type: 'MUSIC' },
    },
    play_behavior: 'REPLACE_ALL',
  }
  // music 必须是 JSON 字符串，直接传对象音箱不认
  return await ubus(token, deviceId, 'player_play_music', 'mediaplayer', { startaudioid: audioId, music: JSON.stringify(music) })
}

/** 按 hardware 自动选接口：老固件 player_play_url，新固件 player_play_music。 */
export async function playByUrl(token, deviceId, url) {
  const hardware = await hardwareOf(token, deviceId)
  if (USE_PLAY_MUSIC.has(String(hardware).toUpperCase())) return await playByMusicUrl(token, deviceId, url)
  return await ubus(token, deviceId, 'player_play_url', 'mediaplayer', { url: url, type: 2, media: 'app_ios' })
}

/** 她听到的话：nlp_result_get 里每一条 nlp 拿出来，取问题与回答。 */
const CONV_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Safari/605.1.15'

/**
 * 小爱最近听到了什么。
 * 走 device_profile/v2/conversation（xiaogpt 用的就是这条），
 * 而不是 ubus 的 nlp_result_get —— 后者在 LX04 上实测返回空数组，抓不到任何对话。
 * 需要三个 cookie：userId / deviceId / serviceToken。
 */
export async function latestAsk(token, deviceId, hardware) {
  const out = []
  const serviceToken = Array.isArray(token.micoapi) ? token.micoapi[1] : ''
  if (!serviceToken) return out
  const url = 'https://userprofile.mina.mi.com/device_profile/v2/conversation?source=dialogu'
    + '&hardware=' + encodeURIComponent(hardware || 'LX04')
    + '&timestamp=' + Date.now()
    + '&limit=5'
  const res = await requestJson({
    method: 'GET',
    url: url,
    headers: { 'User-Agent': CONV_UA },
    cookies: { userId: token.userId, deviceId: deviceId, serviceToken: serviceToken },
  })
  if (res.status !== 200 || !res.json || Number(res.json.code) !== 0) return out
  let data = res.json.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch (error) {
      return out
    }
  }
  const records = data && Array.isArray(data.records) ? data.records : []
  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue
    const answers = Array.isArray(rec.answers) ? rec.answers : []
    let answer = ''
    for (const row of answers) {
      const tts = row && row.tts && typeof row.tts.text === 'string' ? row.tts.text : ''
      if (!answer && tts) answer = tts
    }
    out.push({
      requestId: String(rec.requestId || ''),
      timestampMs: Number(rec.time || 0) || 0,
      question: typeof rec.query === 'string' ? rec.query.trim() : '',
      answer: answer.trim(),
    })
  }
  return out
}

export const HARDWARE_PLAY_MUSIC = USE_PLAY_MUSIC
