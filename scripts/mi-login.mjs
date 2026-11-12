#!/usr/bin/env node
// 手动登录小米账号，把 token 落到 $DSH_HOME/anima/mi.json。这个脚本只在用户自己的机器上跑。
// 用法：
//   node scripts/mi-login.mjs                     账号、密码都交互输入（密码显示为 *）
//   node scripts/mi-login.mjs --account 138xxxx  账号从参数来，密码仍交互
//   node scripts/mi-login.mjs --out D:/x/mi.json  换 token 路径
//   node scripts/mi-login.mjs --qr                扫码登录（不碰短信，短信被风控拦时用这个）
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { debugDump, debugEnabled, deviceList, fetchQrImage, login, loginWithPassToken, loadToken, qrLogin, refreshToken, saveToken, TOKEN_PATH } from '../packages/dsh-anima/lib/xiaomi.js'

function parseArgv(argv) {
  const out = { account: '', out: '', qr: false, resume: false, debug: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--account' || arg === '-a') out.account = String(argv[++i] || '').trim()
    else if (arg === '--out' || arg === '-o') out.out = String(argv[++i] || '').trim()
    else if (arg === '--qr' || arg === '-q') out.qr = true
    else if (arg === '--resume') out.resume = true
    else if (arg === '--cookie') out.cookie = true
    else if (arg === '--debug') out.debug = true
    else if (arg === '--help' || arg === '-h') out.help = true
  }
  return out
}

function say(line) {
  process.stdout.write(line + '\n')
}

// ---- 输入层：不用 readline ----
// 2026-11-08 真机踩坑：把「raw 逐字符读密码」和 readline 混用会互相抢 stdin，
// 现象是密码被明文回显、紧接着的「手机验证码：」一问进程直接退出（事件循环空了）。
// 所以这里只留一套读法：整个脚本期间 stdin 只被一个人读，自己回显。
const stdin = process.stdin
const stdout = process.stdout
let pending = null
let armed = false

function armStream() {
  if (armed) return
  armed = true
  stdin.setEncoding('utf8')
  if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
    stdin.setRawMode(true) // 关掉终端回显，密码才不会漏到屏幕上
  }
  stdin.resume()
}

function disarmStream() {
  if (!armed) return
  armed = false
  if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(false)
  stdin.pause()
}

function settle(answer) {
  const waiter = pending
  pending = null
  if (waiter) waiter.resolve(String(answer || '').trim())
}

// 管道输入时一次 chunk 里可能有好几行，而下一问还没登记等待者，
// 所以已完成的行先入队，readLine 进来时先看队里有没有现成的。
const queue = []
let current = ''

function pump() {
  if (!pending || queue.length === 0) return
  settle(queue.shift())
}

stdin.on('data', function (chunk) {
  const echo = stdin.isTTY === true
  for (const ch of String(chunk)) {
    if (ch === '\u0003') {
      const waiter = pending
      pending = null
      stdout.write('\n')
      if (waiter) waiter.reject(new Error('已取消'))
      return
    }
    if (ch === '\r' || ch === '\n') {
      if (echo) stdout.write('\n')
      queue.push(current)
      current = ''
      pump()
      continue
    }
    if (ch === '\u007f' || ch === '\b') {
      if (current.length > 0) {
        current = current.slice(0, -1)
        if (echo) stdout.write('\b \b')
      }
      continue
    }
    if (ch === '\u001b') continue
    current += ch
    if (echo && pending) stdout.write(pending.masked ? '*' : ch)
  }
})

stdin.on('end', function () {
  if (queue.length > 0 && pending) {
    pump()
    return
  }
  const waiter = pending
  pending = null
  if (waiter) waiter.reject(new Error('没有读到输入（stdin 已关闭）'))
})

function readLine(prompt, masked) {
  return new Promise(function (resolve, reject) {
    armStream()
    // 交互模式下，「等待网络时随手敲的字」不该混进下一问的答案里
    if (stdin.isTTY === true) current = ''
    stdout.write(prompt)
    pending = { resolve: resolve, reject: reject, masked: masked === true }
    pump()
  })
}

const ask = function (question) { return readLine(question, false) }

/** 密码不明文显示：每敲一个字符打一个 *，既能看出「打进去了」又不泄露。 */
function askHidden(question) {
  return readLine(question, true)
}

async function askOtpCode(method) {
  const where = method === 'Email' ? '邮箱' : '手机'
  say('')
  say('小米要求二次验证：验证码已经发到你的' + where + '。')
  return await ask(where + '验证码：')
}

function explain(error) {
  const message = String((error && error.message) || error || '')
  const code = error && error.miCode
  if (code === 70016 || message.includes('账号或密码')) return '账号或密码不对，再试一次（注意大小写和手机号/邮箱别混）'
  if (code === 87001 || message.includes('图形验证码')) return '小米要图形验证码：先在手机上用同一个账号登录一次米家/小米账号，再回来重跑本脚本'
  if (message.includes('验证码')) return '验证码这一步没过（可能已过期）：重跑一次，输快一点'
  if (message.includes('网络不通') || message.includes('超时')) return '网络不通：确认能打开 account.xiaomi.com（代理/VPN 先关掉再试）'
  if (message.includes('ENOTFOUND') || message.includes('ECONNREFUSED')) return '网络不通：DNS 或代理有问题，先确认能访问 account.xiaomi.com'
  return message || '未知错误'
}

async function main() {
  const args = parseArgv(process.argv.slice(2))
  if (args.help) {
    say('用法：node scripts/mi-login.mjs [--account 手机号或邮箱] [--out 自定义路径] [--qr | --resume]')
    say('  --qr      扫码登录：不碰短信验证码（短信被小米风控拦住时用这条）')
    say('  --resume  用已存的 passToken 续一次，不扫码也不输密码')
    say('  --cookie  手工粘贴浏览器里的 userId / passToken 换 token（完全不自动登录）')
    say('  --debug   把每一步请求的形状（凭证打码）写到 .local-preview/mi-debug.json')
    return 0
  }
  const out = args.out || TOKEN_PATH
  if (args.debug) debugEnabled(true)

  const existing = loadToken(out)
  if (existing && existing.userId) {
    say('已经有一份 token（userId ' + existing.userId + '）；继续会覆盖它。')
  }

  let token
  if (args.cookie) {
    say('手工 cookie 通道（token 会写到 ' + out + '）')
    say('不输密码、不发短信、不扫码——只把你浏览器里已有的两段 cookie 拿去做一次令牌交换。')
    say('')
    say('在你自己的浏览器里打开 https://i.mi.com ，确认右上角已经是你要用的那个小米账号，然后：')
    say('  按 F12 → Application / 应用 → Cookies → https://i.mi.com')
    say('  找 userId（纯数字）和 passToken（一长串字母数字）两条，分别复制')
    say('')
    const uid = String(await ask('userId：')).trim()
    if (!/^[0-9]+$/.test(uid)) { say('userId 应该是纯数字，这条看着不对，先退出。'); return 1 }
    const pt = String(await askHidden('passToken（粘贴后回车，输入显示为 *）：')).trim()
    if (pt.length < 40) { say('passToken 只有 ' + pt.length + ' 个字符，多半没粘全，先退出。'); return 1 }
    token = await loginWithPassToken({ userId: uid, passToken: pt, deviceId: (loadToken(out) || {}).deviceId || '', out: out })
    say('换到 serviceToken 了，token 已写到 ' + out)
  } else if (args.resume) {
    say('续登：用已存的 passToken 换 serviceToken（不扫码、不输密码）')
    say('')
    token = await refreshToken(loadToken(out), { out: out })
    say('续登成功，token 已更新：' + out)
  } else if (args.qr) {
    say('扫码登录（token 会写到 ' + out + '）')
    say('这条不碰短信验证码，专治「发短信验证码失败 / 用户行为被限制」。')
    say('')
    let qrPath = ''
    token = await qrLogin({
      out: out,
      deviceId: (loadToken(out) || {}).deviceId || '',
      onQr: async function (url, info) {
        const buf = await fetchQrImage(url)
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
        const name = 'mi-qr-' + stamp + '.png'
        // 固定文件名会被「上次那张还开在图片查看器里」锁住，所以每次换名；
        // .dsh\anima 写不进时退到当前目录，再不行就把地址打出来让用户自己在浏览器开。
        for (const target of [join(dirname(out), name), join(process.cwd(), name)]) {
          try {
            mkdirSync(dirname(target), { recursive: true })
            writeFileSync(target, buf)
            qrPath = target
            break
          } catch (error) {
            // 换下一个落点
          }
        }
        if (qrPath) {
          say('二维码已存到：' + qrPath)
          say('用小米手机「设置 > 小米账号 > 扫一扫」扫它（米家 App 的扫一扫也行）。')
        } else {
          say('二维码存不下来，直接把这个地址粘进浏览器，对屏幕上扫：')
          say(url)
        }
        if (info && info.qrTips) say('小米提示：' + info.qrTips)
        say('')
      },
      onWait: function () {
        say('等你扫码（最多 5 分钟，这个窗口别关）…')
      },
    })
    say('登录成功，token 已写到 ' + out)
  } else {
    say('小米账号登录（token 会写到 ' + out + '）')
    say('提示：密码只用来算一次 md5 换 serviceToken，脚本不保存密码。')
    say('')
    const account = args.account || await ask('小米账号（手机号/邮箱）：')
    if (!account) {
      say('没给账号，退出。')
      return 1
    }
    const password = await askHidden('密码（输入显示为 *，回车确认）：')
    if (!password) {
      say('没给密码，退出。')
      return 1
    }
    say('')
    say('正在登录…')
    token = await login({ username: account, password: password, otpCallback: askOtpCode })
    say('登录成功，token 已写到 ' + out)
  }

  say('')
  say('正在读取设备列表…')
  const devices = await deviceList(token)
  if (!devices.length) {
    say('这个账号下没有小爱音箱设备（或者登录的不是米家绑定的那个账号）。')
    return 0
  }
  say('')
  say('设备（共 ' + devices.length + ' 台）：')
  const pad = function (text, width) { return String(text || '').padEnd(width, ' ') }
  say('  ' + pad('deviceID', 24) + pad('name', 20) + 'hardware')
  for (const row of devices) {
    say('  ' + pad(row.deviceID, 24) + pad(row.name, 20) + row.hardware)
  }
  say('')
  say('下一步：重载插件后 curl http://127.0.0.1:14433/anima/api/xiaomi/devices 应该能看到同一份列表。')
  return 0
}

main().then(function (code) {
  disarmStream()
  process.exit(code)
}, function (error) {
  disarmStream()
  if (process.argv.indexOf('--debug') >= 0) {
    try {
      const dir = join(process.cwd(), '.local-preview')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'mi-debug.json')
      writeFileSync(file, JSON.stringify({ error: String((error && error.message) || error), trace: debugDump() }, null, 2))
      say('调试记录已写到：' + file)
    } catch (writeError) {
      say('调试记录写不出来：' + String(writeError && writeError.message))
    }
  }
  say('')
  say('登录失败：' + explain(error))
  const detail = String((error && error.message) || error || '')
  if (detail) say('原始错误：' + detail)
  process.exit(1)
})
