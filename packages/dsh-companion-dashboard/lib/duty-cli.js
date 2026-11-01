/**
 * 值班 CLI 包装器（dsh-companion-dashboard）
 *
 * 1) 必须换真 node：dsh-bili-pond 拉起值班子进程时用的是
 *      command = process.execPath（桌面版就是 Electron 二进制）
 *      env.ELECTRON_RUN_AS_NODE = 1
 *      args = [cfg.dshBin]
 *    Electron 44.7.0 的 V8（15.2.124.28-electron.0）不在 dsh CLI 自带的
 *    node-addon-native-custom-loader 指纹表里（只认 43.0.0 / 44.0.0 / 45.0.0-alpha.6）
 *    ⇒ 引导阶段 installRuntimeInterception 抛 Unsupported/no-context，0 秒 exit 1。
 *    本包装器自己也是被 Electron 当 node 跑的（纯 JS，不碰原生加载器），它把参数
 *    原样转交给**真正的 node.exe + dsh bin.js**，指纹检查根本不发生。
 *
 * 2) 只留一个很高的硬上限（默认 45 分钟）。不按「静默多久」杀进程 —— 值班一轮里
 *    模型思考、抓字幕、跑 ffmpeg 都可能长时间不出新事件；2026-10-31 实测 90s 静默阈值
 *    把一轮已经写好 3 条视频的报告打断了。headless 自己会正常退出（实测 5 秒）。
 *
 * 配置：<DSH_HOME>/companion/duty-cli.json  { "node": "...node.exe", "bin": "...dsh/lib/bin.js" }
 * 由控制中心写入；缺配置时自己猜一次（where node + where dsh），猜不到就明说。
 * 调参：DUTY_CLI_MAX_MS（默认 2700000）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const configPath = () => join(dshHome(), 'companion', 'duty-cli.json')
const num = (raw, fallback) => {
  const v = Number(raw)
  return Number.isFinite(v) && v > 0 ? v : fallback
}
const MAX_MS = num(process.env.DUTY_CLI_MAX_MS, 2_700_000)
const ERROR_MARK = /^dsh: [A-Z][A-Z0-9_]*: /

function readConfig() {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8'))
    if (raw && typeof raw === 'object') return raw
  } catch {}
  return {}
}

function which(cmd) {
  try {
    const r = spawnSync('cmd.exe', ['/c', 'where', cmd], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
    return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  } catch { return [] }
}

function fallbackNode() {
  const self = process.execPath
  for (const p of which('node')) if (p !== self && existsSync(p)) return p
  for (const p of [
    'C:/Program Files/nodejs/node.exe',
    'D:/nodejs/node.exe',
    join(process.env.APPDATA || '', 'npm', 'node.exe'),
  ]) if (p && existsSync(p)) return p
  return ''
}

function fallbackBin() {
  for (const p of which('dsh')) {
    const guess = join(dirname(p), 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (existsSync(guess)) return guess
  }
  const appdata = join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  return existsSync(appdata) ? appdata : ''
}

const conf = readConfig()
const nodePath = (typeof conf.node === 'string' && existsSync(conf.node)) ? conf.node : fallbackNode()
const cliPath = (typeof conf.bin === 'string' && existsSync(conf.bin)) ? conf.bin : fallbackBin()

if (!nodePath || !cliPath) {
  console.error('[duty-cli] 找不到真正的 node 或 dsh CLI；到控制中心的「B站」分支点一次「修复值班 CLI」')
  console.error('[duty-cli] node=' + (nodePath || '(空)') + ' bin=' + (cliPath || '(空)') + ' config=' + configPath())
  process.exit(2)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

let sawOutput = false
let sawErrorMark = false
let stopped = false
let killTimer = null

const child = spawn(nodePath, [cliPath, ...process.argv.slice(2)], { stdio: ['ignore', 'pipe', 'pipe'], env, cwd: process.cwd(), windowsHide: true })

child.stdout.on('data', (buf) => {
  sawOutput = true
  process.stdout.write(buf)
})
child.stderr.on('data', (buf) => {
  sawOutput = true
  for (const line of String(buf).split(/\r?\n/)) if (ERROR_MARK.test(line)) sawErrorMark = true
  process.stderr.write(buf)
})

const hardTimer = setTimeout(() => {
  if (stopped) return
  stopped = true
  console.error('[duty-cli] 超过硬上限 ' + Math.round(MAX_MS / 60000) + ' 分钟 → 收尾（报告可能不完整）')
  try { child.kill('SIGTERM') } catch {}
  killTimer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 5_000)
}, MAX_MS)

child.on('error', (error) => {
  console.error('[duty-cli] 转交失败：' + error.message + ' → ' + nodePath)
  process.exit(2)
})

child.on('exit', (code, signal) => {
  clearTimeout(hardTimer)
  if (killTimer) clearTimeout(killTimer)
  if (stopped) {
    process.exit(sawErrorMark || !sawOutput ? 1 : 0)
    return
  }
  if (typeof code === 'number') process.exit(code)
  console.error('[duty-cli] 子进程被信号结束：' + String(signal) + (sawErrorMark ? '（期间出现过错误行）' : ''))
  process.exit(1)
})
