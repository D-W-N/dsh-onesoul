import assert from 'node:assert/strict'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'onesoul-tar-'))

const mod = await import('../.work/inst/node_modules/dsh-onesoul/plugins/anima/lib/index.js')
const tools = new Map()
const sections = []
const ctx = {
  config: {}, logger: { warn() {}, info() {} },
  effect(fn) { const d = fn(); return d },
  get(name) { if (name === 'systemPrompt') return ctx.systemPrompt; return null },
  tools: { register(d) { tools.set(d.name, d); return () => {} } },
  systemPrompt: { section(s) { sections.push(s); return () => {} } },
  webServer: { register() { return () => {} } },
}
mod.apply(ctx, {})
for (const t of ['anima_status', 'anima_state_get', 'anima_presence_move', 'anima_mood_note', 'anima_quiet']) {
  assert.ok(tools.has(t), '内置副本缺工具 ' + t)
}
const text = sections[0].text()
assert.ok(text.includes('## 此刻的状态'), '内置副本的提示词没有此刻的状态段')
await tools.get('anima_quiet').execute({ action: 'goodnight' }, {})
assert.ok(sections[0].text().includes('静默中'))
assert.ok(existsSync(join(process.env.DSH_HOME, 'anima', 'runtime.json')))
console.log('TARBALL OK  tools=' + tools.size + '  runtime.json 落盘 提示词含此刻状态')
