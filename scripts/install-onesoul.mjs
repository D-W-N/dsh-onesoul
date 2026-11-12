#!/usr/bin/env node
/**
 * 把本地打好的 dsh-onesoul tarball 铺进运行用的 profile。
 *
 *   node scripts/install-onesoul.mjs                 # 默认 desktop profile + 最新 tarball
 *   node scripts/install-onesoul.mjs --profile web
 *   node scripts/install-onesoul.mjs --tgz .local-tarballs/dsh-onesoul-0.1.4.tgz
 *
 * 为什么不用 pnpm install：这个 profile 的 node_modules 是从 `C:\Users\1\.dsh`（junction 到
 * `D:\DSH\.dsh`）路径装的，pnpm 会报 ERR_PNPM_UNEXPECTED_VIRTUAL_STORE；而且桌面应用运行时
 * 锁着包里的文件，只能「应用完全退出 → 铺 → 再打开」。
 */
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const out = { profile: 'desktop', tgz: null }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--profile') { out.profile = argv[i + 1]; i += 1 }
    else if (argv[i] === '--tgz') { out.tgz = argv[i + 1]; i += 1 }
  }
  return out
}

function latestTarball() {
  const dir = join(root, '.local-tarballs')
  const files = readdirSync(dir)
    .filter((name) => /^dsh-onesoul-\d+\.\d+\.\d+\.tgz$/.test(name))
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => a.at - b.at)
  if (!files.length) throw new Error('.local-tarballs 里没有 dsh-onesoul-*.tgz，先跑 node scripts/build-onesoul.mjs --pack')
  return join(dir, files[files.length - 1].name)
}

const args = parseArgs(process.argv.slice(2))
const dshHome = (process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', args.profile)
const target = join(profileDir, 'node_modules', 'dsh-onesoul')
const tgz = args.tgz ? join(root, args.tgz) : latestTarball()

if (!existsSync(join(profileDir, 'package.json'))) throw new Error('找不到 profile：' + profileDir)
if (!existsSync(tgz)) throw new Error('找不到 tarball：' + tgz)

const work = mkdtempSync(join(profileDir, 'node_modules', '.onesoul-staging-'))
execSync('tar -xzf "' + tgz + '" -C "' + work + '"', { stdio: 'inherit' })
const staged = join(work, 'package')
const stagedVersion = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8')).version

let installedBefore = 'missing'
try { installedBefore = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version } catch {}

try {
  rmSync(target, { recursive: true, force: true })
  try {
    renameSync(staged, target)
  } catch (error) {
    // 跨卷 rename 会 EXDEV；staging 已放在同一卷，但仍有杀毒/索引器插手的可能，退回复制
    if (!error || error.code !== 'EXDEV') throw error
    cpSync(staged, target, { recursive: true })
  }
} catch (error) {
  throw new Error(
    '铺包失败（' + (error && error.message ? error.message : error) + '）。\n' +
    '最常见原因：桌面应用还在跑，锁着 ' + target + ' 下的文件。\n' +
    '请完全退出 DSH 桌面应用（任务管理器里不应再有 DSH / electron 进程）后重跑本命令。',
  )
}

// 依赖指向本地 tarball，免得下次有人跑 install 时被 registry 上的旧版本覆盖
const pkgPath = join(profileDir, 'package.json')
const manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
manifest.dependencies = manifest.dependencies || {}
manifest.dependencies['dsh-onesoul'] = 'file:' + tgz.replace(/\\/g, '/')
writeFileSync(pkgPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

const after = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version
const clientFile = join(target, 'plugins', 'dashboard', 'lib', 'client.js')
const clientId = existsSync(clientFile)
  ? (/id: '([^']+)',/.exec(readFileSync(clientFile, 'utf8')) || [])[1] || 'unknown'
  : 'missing'
const animaLib = existsSync(join(target, 'plugins', 'anima', 'lib'))
  ? readdirSync(join(target, 'plugins', 'anima', 'lib')).length
  : 0

rmSync(work, { recursive: true, force: true })
console.log('profile : ' + profileDir)
console.log('tarball : ' + tgz)
console.log('version : ' + installedBefore + ' -> ' + after + (after === stagedVersion ? ' (ok)' : ' (版本不符，检查 tarball)'))
console.log('client  : id=' + clientId + (clientId === 'dsh-onesoul' ? ' (ok)' : ' (应为 dsh-onesoul)'))
console.log('anima   : ' + animaLib + ' 个 lib 文件' + (animaLib >= 9 ? ' (ok)' : ' (偏少，检查 vendoring)'))
console.log('dep     : ' + manifest.dependencies['dsh-onesoul'])
