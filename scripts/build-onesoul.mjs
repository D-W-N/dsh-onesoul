#!/usr/bin/env node
/**
 * 把 packages/dsh-anima 与 packages/dsh-companion-dashboard 的内置副本同步进
 * packages/dsh-onesoul/plugins/，让本仓库仍然按「三个开发包」维护，
 * 对外只发布 dsh-onesoul 一个包。
 *
 *   node scripts/build-onesoul.mjs          # 同步
 *   node scripts/build-onesoul.mjs --pack   # 同步后 npm pack 到 .verify/tarballs
 */
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'packages', 'dsh-onesoul')
const plugins = join(pkgDir, 'plugins')

const sources = [
  { key: 'anima', from: join(root, 'packages', 'dsh-anima', 'lib'), to: join(plugins, 'anima', 'lib') },
  { key: 'dashboard', from: join(root, 'packages', 'dsh-companion-dashboard', 'lib'), to: join(plugins, 'dashboard', 'lib') },
]

rmSync(plugins, { recursive: true, force: true })
mkdirSync(plugins, { recursive: true })

for (const item of sources) {
  if (!existsSync(item.from)) throw new Error('missing source: ' + item.from)
  cpSync(item.from, item.to, { recursive: true })
  const files = readdirSync(item.to).map((name) => name + ' ' + statSync(join(item.to, name)).size)
  console.log('vendored ' + item.key + ' -> plugins/' + item.key + '/lib  (' + files.length + ' files)')
  for (const line of files) console.log('  ' + line)
}

const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
console.log('package: ' + manifest.name + '@' + manifest.version)
console.log('entry:   lib/index.js -> plugins/anima/lib/index.js + plugins/dashboard/lib/index.js')
console.log('client:  ' + manifest.exports['./client'])

if (process.argv.includes('--pack')) {
  const out = join(root, '.verify', 'tarballs')
  mkdirSync(out, { recursive: true })
  const res = execSync('npm pack --pack-destination "' + out + '" --cache "' + join(root, '.probe', 'npmcache') + '" --silent', { cwd: pkgDir, encoding: 'utf8', shell: true })
  console.log('packed: ' + out + '\\' + res.trim().split(/\r?\n/).pop())
}
