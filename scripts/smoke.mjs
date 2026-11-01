/**
 * 假 ctx 冒烟：不启动 DSH，直接 import 三个宿主半，断言工具/路由/系统提示注册，
 * 并把工具与 HTTP handler 真跑一遍。用 node --test 运行。
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'companion-smoke-'))
process.env.DSH_HOME = home

function makeCtx() {
  const tools = new Map()
  const sections = []
  const routes = []
  const disposers = []
  const ctx = {
    config: {},
    logger: { warn() {}, info() {} },
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
    get(name) {
      if (name === 'systemPrompt') return ctx.systemPrompt
      if (name === 'webServer') return ctx.webServer
      if (name === 'llm') return ctx.llm || null
      if (name === 'agentDefaultModel') return ctx.agentDefaultModel || null
      if (name === 'agents') return ctx.agents || null
      return null
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return function () {}
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return function () {}
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return function () {}
      },
    },
  }
  return { ctx, tools, sections, routes, disposers }
}

function callHandler(routes, prefix, pathname, options) {
  const route = routes.find(function (item) { return item.path === prefix })
  if (!route) throw new Error('route not registered: ' + prefix)
  const opts = options || {}
  const listeners = {}
  const req = {
    method: opts.method || 'GET',
    url: prefix + pathname,
    socket: { remoteAddress: '127.0.0.1' },
    on(event, handler) {
      listeners[event] = handler
      return req
    },
    destroy() {},
  }
  const result = { status: 0, body: '' }
  const res = {
    writeHead(status) { result.status = status },
    end(body) { result.body = String(body || '') },
  }
  const done = route.handler(req, res)
  if (opts.body !== undefined) {
    listeners.data(Buffer.from(JSON.stringify(opts.body)))
    listeners.end()
  } else if (listeners.end) {
    listeners.end()
  }
  return Promise.resolve(done).then(function () {
    return { status: result.status, json: result.body ? JSON.parse(result.body) : null }
  })
}

const anima = await import('../packages/dsh-anima/lib/index.js')
const eph = await import('../packages/dsh-anima/lib/ephemeral.js')

test('anima: 注册工具 / 系统提示段落 / HTTP 路由', async function () {
  const env = makeCtx()
  anima.apply(env.ctx, {})
  assert.equal(anima.name, 'dsh-anima')
  for (const tool of ['anima_status', 'anima_persona_get', 'anima_persona_set', 'anima_memory_capture', 'anima_memory_pending', 'anima_memory_decide', 'anima_memory_search', 'anima_memory_import']) {
    assert.ok(env.tools.has(tool), '缺少工具 ' + tool)
  }
  assert.equal(env.sections.length, 1)
  assert.equal(env.sections[0].name, 'companion:anima')
  assert.ok(env.routes.some(function (item) { return item.path === '/anima/api' }))
  env.sections[0].text() // 首次热读不抛错
})

test('anima: webServer 晚就绪时靠 ctx.inject 补挂路由（桌面 404 回归）', async function () {
  const env = makeCtx()
  env.ctx.webServer = null
  const waiting = []
  env.ctx.inject = function (deps, callback) { waiting.push({ deps: deps, callback: callback }) }
  anima.apply(env.ctx, {})
  assert.equal(env.routes.length, 0, 'webServer 未就绪时不该假装挂上')
  assert.ok(env.tools.has('anima_status'), '路由没挂也不能影响工具注册')
  assert.equal(waiting.length, 1, '应当登记一次 webServer 等待')
  assert.deepEqual(waiting[0].deps, ['webServer'])
  const lateRoutes = []
  waiting[0].callback({ get: function (name) { return name === 'webServer' ? { register: function (route) { lateRoutes.push(route); return function () {} } } : null } })
  assert.ok(lateRoutes.some(function (item) { return item.path === '/anima/api' }), 'webServer 出现后必须补挂 /anima/api')
})

test('anima: 记忆必须裁决才进入人格注入', async function () {
  const env = makeCtx()
  anima.apply(env.ctx, {})
  const section = env.sections[0]
  const capture = await env.tools.get('anima_memory_capture').execute({ text: '用户讨厌被叫“您”，喜欢直接称呼。', tags: ['偏好'] }, {})
  assert.match(capture, /候选池/)
  const before = section.text()
  assert.ok(before.includes('待用户裁决的候选记忆'), '候选应出现在候选区')
  assert.ok(!before.includes('- 用户讨厌被叫'), '候选不得进入已确认记忆区')

  const pending = JSON.parse(await env.tools.get('anima_memory_pending').execute({}, {}))
  assert.equal(pending.length, 1)
  const decided = await env.tools.get('anima_memory_decide').execute({ id: pending[0].id, decision: 'approve' }, {})
  assert.match(decided, /已通过/)
  const after = section.text()
  assert.ok(after.includes('## 已确认的长期记忆（索引）'), '通过后必须有索引区')
  assert.ok(after.includes('- [' + pending[0].id + '] 用户讨厌被叫“您”'), '通过后必须出现带 id 的索引行')
  assert.ok(!after.includes('待用户裁决的候选记忆'))
  assert.ok(after.includes('anima_memory_get'), '索引区必须告诉模型怎么取全文')

  const full = await env.tools.get('anima_memory_get').execute({ id: pending[0].id }, {})
  assert.match(full, /用户讨厌被叫“您”，喜欢直接称呼。/, '按 id 才拿到全文')
  const missing = await env.tools.get('anima_memory_get').execute({ id: 'mem_nope' }, {})
  assert.match(missing, /没有这条记忆/)
})

test('anima: 人格设置对注入生效，工作区覆盖只影响该工作区', async function () {
  const env = makeCtx()
  anima.apply(env.ctx, {})
  const section = env.sections[0]
  await env.tools.get('anima_persona_set').execute({ name: '阿音', userCall: '你', style: '短句', boundaries: ['不装记得'] }, {})
  const text = section.text()
  assert.ok(text.includes('名字：阿音'))
  assert.ok(text.includes('- 不装记得'))
  await env.tools.get('anima_persona_set').execute({ name: '工作区专用名', scope: 'E:\\demo' }, {})
  assert.ok(!section.text().includes('工作区专用名'), '未命中工作区时不应用覆盖')
})

test('anima: HTTP 路由可读候选并裁决', async function () {
  const env = makeCtx()
  anima.apply(env.ctx, {})
  await env.tools.get('anima_memory_capture').execute({ text: '记忆 A' }, {})
  const status = await callHandler(env.routes, '/anima/api', '/status')
  assert.equal(status.json.ok, true)
  assert.equal(status.json.data.counts.pending >= 1, true)
  const pending = await callHandler(env.routes, '/anima/api', '/pending')
  const id = pending.json.data.entries[0].id
  const decided = await callHandler(env.routes, '/anima/api', '/decide', { method: 'POST', body: { id: id, decision: 'reject' } })
  assert.equal(decided.json.data.status, 'rejected')
  const persona = await callHandler(env.routes, '/anima/api', '/persona', { method: 'POST', body: { name: '路由改名' } })
  assert.equal(persona.json.data.name, '路由改名')
  const again = await callHandler(env.routes, '/anima/api', '/decide', { method: 'POST', body: { id: id, decision: 'approve' } })
  assert.equal(again.json.ok, false, '已裁决的记忆不得二次裁决')
})

test('anima: 外部记忆批量导入落为候选', async function () {
  const env = makeCtx()
  anima.apply(env.ctx, {})
  const preview = await env.tools.get('anima_memory_import').execute({ text: '- 喜欢深夜写代码\n- 讨厌语音', dryRun: true }, {})
  assert.match(preview, /预览（2 条/)
  const applied = await env.tools.get('anima_memory_import').execute({ text: '- 喜欢深夜写代码\n- 讨厌语音' }, {})
  assert.match(applied, /已导入 2 条候选记忆/)
})

test('anima: 临时记忆解析两种报告格式、跳过围栏日志、同 BVID 去重', async function () {
  const text = [
    '# B站鱼塘 · 2026-11-01 第 2 轮（00:44）',
    '## 挑中（优先看）',
    '### BV1pFx16cE5B',
    '**标题**：Super-agent 常驻智能体',
    '**UP**：渐近自由JJZY（3:38 · 8,432 播放）',
    '**链接**：https://www.bilibili.com/video/BV1pFx16cE5B',
    '**为什么值得**：把协调员+办事员讲清楚了',
    '## 跳过',
    '- 2026-11-01 · BV1GGxC65E1k · 插件盘点 · 某人（1:02 · 300 播放） · 跳过：字幕额度不够 · https://www.bilibili.com/video/BV1GGxC65E1k',
    '- 2026-11-01 · BV1pFx16cE5B · 只有标题没有点评',
    '```',
    '### BV1zzzzzzzzz',
    '- BV1yyyyyyyyy 围栏内的日志不该被当成条目',
    '```',
  ].join('\n')
  const rows = eph.parseReport(text)
  assert.equal(rows.length, 2, '围栏里的内容不参与解析')
  const picked = rows.find(function (row) { return row.bvid === 'BV1pFx16cE5B' })
  assert.equal(picked.picked, true)
  assert.equal(picked.up, '渐近自由JJZY', 'UP 行里的名字要单独取出来')
  assert.equal(picked.plays, '8,432')
  assert.equal(picked.duration, '3:38')
  assert.ok(picked.url.startsWith('https://www.bilibili.com/video/BV1pFx16cE5B'))
  assert.match(picked.verdict, /协调员\+办事员/)
  assert.match(picked.round, /2026-11-01 第 2 轮/)
  const skipped = rows.find(function (row) { return row.bvid === 'BV1GGxC65E1k' })
  assert.equal(skipped.picked, false)
  assert.equal(skipped.verdictKind, '跳过')
  assert.match(skipped.verdict, /字幕额度不够/)
})

test('anima: 临时记忆刷新落盘 + 提示段 + 取全文工具 + HTTP 路由', async function () {
  const dir = join(home, 'bili-duty')
  mkdirSync(join(dir, 'out'), { recursive: true })
  writeFileSync(join(dir, 'out', '2026-11-01.md'), [
    '# B站鱼塘 · 2026-11-01 第 1 轮',
    '## 挑中（优先看）',
    '### BV1pFx16cE5B',
    '**标题**：Super-agent 常驻智能体',
    '**UP**：渐近自由JJZY（3:38 · 8,432 播放）',
    '**链接**：https://www.bilibili.com/video/BV1pFx16cE5B',
    '**为什么值得**：讲清了协调员与办事员的分工，还给了模拟数据。',
    '## 跳过',
    '- 2026-11-01 · BV1GGxC65E1k · 插件盘点 · 某人（1:02 · 300 播放） · 跳过：字幕额度不够 · https://www.bilibili.com/video/BV1GGxC65E1k',
  ].join('\n'))
  writeFileSync(join(dir, 'out', '2026-10-31.md'), '# 这一轮没写出报告\n\n```\n### BV1zzzzzzzzz\n```\n')

  const refreshed = await eph.refreshEphemeral({ dir: dir })
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.total, 2, '失败模板那份不该产出条目')
  assert.equal(refreshed.picked, 1)
  assert.equal(refreshed.newPicked.length, 1, 'newPicked 是这次新出现的挑中条目')
  assert.ok(existsSync(eph.ephemeralPath()))
  const saved = JSON.parse(readFileSync(eph.ephemeralPath(), 'utf8'))
  assert.equal(saved.version, 1)
  assert.deepEqual(saved.days.map(function (day) { return day.date }), ['2026-11-01', '2026-10-31'])
  assert.equal(saved.days[0].entries.length, 2)
  assert.equal(saved.days[1].entries.length, 0, '只有「没写出报告」的那天不该产出条目')

  const section = eph.renderEphemeralSection(saved, {})
  assert.match(section, /## 临时记忆：B站值班/)
  assert.match(section, /直接照这里回答/, '提示段必须让模型直接照这里答，别再调工具')
  assert.match(section, /BV1pFx16cE5B/)
  assert.match(section, /挑中：讲清了协调员/)
  assert.equal(eph.renderEphemeralSection({ days: [], total: 0 }, {}), '', '没有数据时不注入空段')

  const env = makeCtx()
  anima.apply(env.ctx, {})
  const prompt = env.sections[0].text()
  assert.match(prompt, /临时记忆：B站值班/, '系统提示要带上临时记忆段')
  assert.match(prompt, /anima_ephemeral_get/)

  const byBvid = await env.tools.get('anima_ephemeral_get').execute({ bvid: 'BV1pFx16cE5B' }, {})
  assert.match(byBvid, /Super-agent 常驻智能体/)
  assert.match(byBvid, /渐近自由JJZY/)
  const noHit = await env.tools.get('anima_ephemeral_get').execute({ query: '根本没有这个词' }, {})
  assert.match(noHit, /没有匹配/)
  const routed = await callHandler(env.routes, '/anima/api', '/ephemeral')
  assert.equal(routed.status, 200)
  assert.equal(routed.json.data.total, 2)
  assert.equal(routed.json.data.picked, 1)
})

test('anima: 临时记忆自动写入，值班挑中不进审核队列', async function () {
  const env = makeCtx()
  anima.apply(env.ctx, {})
  await env.tools.get('anima_ephemeral_refresh').execute({}, {}) // 先吃掉启动时那次刷新
  mkdirSync(join(home, 'bili-duty', 'out'), { recursive: true })
  writeFileSync(join(home, 'bili-duty', 'out', '2026-11-02.md'), [
    '# B站鱼塘 · 2026-11-02 第 1 轮',
    '## 挑中（优先看）',
    '### BV1abcdefgh2',
    '**标题**：新挑中的一条',
    '**UP**：某UP（1:11 · 222 播放）',
    '**链接**：https://www.bilibili.com/video/BV1abcdefgh2',
    '**为什么值得**：值得记一笔',
  ].join('\n'))
  const first = JSON.parse(await env.tools.get('anima_ephemeral_refresh').execute({}, {}))
  assert.equal(first.capturedCandidates, 0, '值班挑中不再落候选记忆')
  assert.ok(first.picked >= 1, '挑中的条目仍写进临时记忆')
  const got = await env.tools.get('anima_ephemeral_get').execute({ bvid: 'BV1abcdefgh2' }, {})
  assert.match(got, /新挑中的一条/, '临时记忆里能取到全文')
  const pending = JSON.parse(await env.tools.get('anima_memory_pending').execute({ limit: 50 }, {}))
  assert.equal(pending.filter(function (entry) { return entry.source === 'bili-duty' }).length, 0, '审核队列里不得出现值班条目')
  const onDisk = JSON.parse(readFileSync(join(home, 'anima', 'memory.json'), 'utf8'))
  assert.equal(onDisk.entries.filter(function (entry) { return String(entry.note || '').indexOf('bili:') === 0 }).length, 0, '落盘也不得留 bili: 候选')
})

const dashboard = await import('../packages/dsh-companion-dashboard/lib/index.js')

test('anima: 记忆生效范围（全局 / 仅 Onesoul 通道）', async function () {
  const env = makeCtx()
  anima.apply(env.ctx, {})
  await env.tools.get('anima_memory_capture').execute({ text: '范围冒烟：主人喜欢短句回复。', source: 'smoke-scope', evidence: '冒烟用例自己写的' }, {})
  const pending = JSON.parse(await env.tools.get('anima_memory_pending').execute({}, {}))
  const mine = pending.find(function (row) { return row.text.indexOf('范围冒烟') === 0 })
  await env.tools.get('anima_memory_decide').execute({ id: mine.id, decision: 'approve' }, {})

  const desktop = { agent: { id: 'session-abc-123' } }
  const qq = { agent: { id: 'onebot-private-3953927738' } }

  const defaults = await callHandler(env.routes, '/anima/api', '/settings')
  assert.equal(defaults.json.data.memoryScope, 'global')
  assert.deepEqual(defaults.json.data.channelPrefixes, ['onebot-'])
  assert.match(env.sections[0].text(desktop), /已确认的长期记忆（索引）/, '全局模式下桌面会话也应有记忆')

  const saved = await callHandler(env.routes, '/anima/api', '/settings', { method: 'POST', body: { memoryScope: 'onesoul' } })
  assert.equal(saved.status, 200)
  assert.equal(saved.json.data.memoryScope, 'onesoul')
  const onDisk = JSON.parse(readFileSync(join(home, 'anima', 'settings.json'), 'utf8'))
  assert.equal(onDisk.memoryScope, 'onesoul')

  const desktopPrompt = env.sections[0].text(desktop)
  assert.equal(desktopPrompt, '', '仅通道模式下普通会话一条注入都不该有（人设、小抄、记忆全隔开）')
  const qqPrompt = env.sections[0].text(qq)
  assert.match(qqPrompt, /已确认的长期记忆（索引）/, 'QQ 通道必须继续拿到记忆')
  assert.match(qqPrompt, /## 你的人设/, '通道里人设照旧')
  assert.match(qqPrompt, /## 通道小抄/, '通道里小抄照旧')

  const bad = await callHandler(env.routes, '/anima/api', '/settings', { method: 'POST', body: { memoryScope: 'everywhere' } })
  assert.equal(bad.status, 400)

  const channelEnv = makeCtx()
  anima.apply(channelEnv.ctx, { channelProfile: true })
  assert.match(channelEnv.sections[0].text(desktop), /已确认的长期记忆（索引）/, '值班 profile 整个进程都算通道')

  await callHandler(env.routes, '/anima/api', '/settings', { method: 'POST', body: { memoryScope: 'global' } })
  assert.equal(JSON.parse(readFileSync(join(home, 'anima', 'settings.json'), 'utf8')).memoryScope, 'global', '后面用例还要看到记忆，必须还原')
})

test('dashboard: 聚合状态读得到 anima 与安装情况', async function () {
  const env = makeCtx()
  dashboard.apply(env.ctx, {})
  assert.equal(dashboard.name, 'dsh-companion-dashboard')
  assert.ok(env.routes.some(function (item) { return item.path === '/companion/api' }), '缺少 /companion/api 路由')

  // 造一个 profile 依赖清单 + 一份 anima 记忆，验证扫描与统计
  mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({
    name: 'web-profile',
    dependencies: { 'dsh-anima': '0.1.0', 'dsh-meme': '0.1.64', 'dsh-better-sidebar': '0.28.1' },
  }))
  mkdirSync(join(home, 'anima'), { recursive: true })
  writeFileSync(join(home, 'anima', 'memory.json'), JSON.stringify({
    version: 1,
    entries: [
      { id: 'm1', text: '候选一', status: 'candidate' },
      { id: 'm2', text: '已确认', status: 'approved' },
      { id: 'm3', text: '拒绝的', status: 'rejected' },
    ],
  }))

  const result = await callHandler(env.routes, '/companion/api', '/status')
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  const data = result.json.data
  assert.equal(data.branches.length, 4)
  assert.deepEqual(data.branches.map(function (item) { return item.id }), ['memory', 'qq', 'bili', 'meme'])
  assert.equal(data.services.anima.installed, true)
  assert.deepEqual(data.services.anima.profiles, ['web'])
  assert.equal(data.services.meme.installed, true)
  assert.equal(data.services.qq.installed, false, 'QQ 未装时必须如实报未安装')
  assert.equal(data.anima.counts.pending, 1)
  assert.equal(data.anima.counts.approved, 1)
  assert.equal(data.anima.counts.rejected, 1)
  assert.equal(data.anima.endpoints.decide, '/anima/api/decide')
})

test('dashboard: 非 loopback 拒绝，未知路由 404', async function () {
  const env = makeCtx()
  dashboard.apply(env.ctx, {})
  const route = env.routes.find(function (item) { return item.path === '/companion/api' })
  const seen = { status: 0, body: '' }
  const res = { writeHead(status) { seen.status = status }, end(body) { seen.body = String(body) } }
  route.handler({ method: 'GET', url: '/companion/api/status', socket: { remoteAddress: '10.1.2.3' } }, res)
  assert.equal(seen.status, 403)
  const unknown = await callHandler(env.routes, '/companion/api', '/nope')
  assert.equal(unknown.status, 404)
})

test('dashboard: NapCat 二维码透传（没有码就 404）', async function () {
  const env = makeCtx()
  dashboard.apply(env.ctx, {})
  const route = env.routes.find(function (item) { return item.path === '/companion/api' })
  const read = function () {
    const seen = { status: 0, headers: null, body: null }
    const res = {
      writeHead(status, headers) { seen.status = status; seen.headers = headers || null },
      end(body) { seen.body = body },
    }
    const req = { method: 'GET', url: '/companion/api/napcat/qr', socket: { remoteAddress: '127.0.0.1' } }
    return Promise.resolve(route.handler(req, res)).then(function () { return seen })
  }

  const missing = await read()
  assert.equal(missing.status, 404, '没有二维码文件时必须 404，不能编一张假图')

  const dir = join(home, 'dsh-napcat-keeper')
  mkdirSync(dir, { recursive: true })
  const qr = join(dir, 'qr.png')
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  writeFileSync(qr, bytes)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ qrCopyPath: qr }))

  // 没有 launch 脚本时，POST /napcat/start 必须 400，不能瞎起进程
  const noLauncher = await (function () {
    const seen = { status: 0, json: null }
    const res = { writeHead(status) { seen.status = status }, end(body) { seen.json = JSON.parse(String(body)) } }
    const req = { method: 'POST', url: '/companion/api/napcat/start', socket: { remoteAddress: '127.0.0.1' }, on() { return req }, destroy() {} }
    return Promise.resolve(route.handler(req, res)).then(function () { return seen })
  })()
  assert.equal(noLauncher.status, 400)
  assert.equal(noLauncher.json.error, 'no-launcher')

  const hit = await read()
  assert.equal(hit.status, 200)
  assert.equal(hit.headers['Content-Type'], 'image/png')
  assert.equal(Buffer.compare(Buffer.from(hit.body), bytes), 0, '必须原样透传字节')
})

test('dashboard 浏览器半: 注册控制中心 Tab', async function () {
  let loaded = null
  globalThis.window = { __ModuleLoader__: { load(options) { loaded = options } } }
  class FakeComponent {
    constructor(props) { this.props = props; this.state = {} }
    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state, this.props) : patch
      this.state = { ...this.state, ...(next || {}) }
    }
    forceUpdate() {}
  }
  FakeComponent.prototype.isReactComponent = {}
  const fakeReact = {
    createElement(type, props, ...children) { return { type, props, children } },
    useState(value) { return [value, function () {}] },
    useEffect() {},
    useCallback(fn) { return fn },
    Component: FakeComponent,
  }
  await import('file:///' + join(process.cwd(), 'packages', 'dsh-companion-dashboard', 'lib', 'client.js').replace(/\\/g, '/') + '?t=' + Date.now())
  assert.ok(loaded, 'client.js 必须以 __ModuleLoader__.load 自注册')
  assert.equal(loaded.id, 'dsh-companion-dashboard', 'loader id 必须等于插件包名')
  const exportsObj = loaded.factory(function (name) {
    if (name === 'react') return fakeReact
    throw new Error('unexpected require: ' + name)
  })
  assert.deepEqual(exportsObj.inject, ['betterSidebar'])
  const registered = []
  const ctx = {
    get(name) { return name === 'betterSidebar' ? { registerTab(descriptor) { registered.push(descriptor); return function () {} } } : null },
    effect(fn) { fn() },
  }
  exportsObj.apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, 'companion:control-center')
  assert.equal(registered[0].single, true)
  assert.equal(typeof registered[0].component, 'function')
})

function makeModelEnv() {
  const env = makeCtx()
  const state = { current: { provider: 'deepseek-web', model: 'deepseek-chat' }, saved: null, saves: 0 }
  env.ctx.llm = {
    listProviders() {
      return [
        { id: 'deepseek-web', name: 'DeepSeek 网页版' },
        { id: 'broken', name: '坏来源' },
      ]
    },
    async listModels(providerId) {
      if (providerId === 'broken') throw new Error('boom')
      return [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      ]
    },
    async resolveModelInfo(providerId, modelId) {
      if (modelId === 'deepseek-reasoner') {
        return { reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'low' } }
      }
      return {}
    },
  }
  env.ctx.agentDefaultModel = {
    currentSelection() { return { ...state.current } },
    async saveSelection(next) { state.saves += 1; state.saved = next; state.current = next },
  }
  dashboard.apply(env.ctx, {})
  return { env, state }
}

test('dashboard: 模型目录 = llm 注册表 + 当前默认选择，坏来源隔离', async function () {
  const { env } = makeModelEnv()
  const result = await callHandler(env.routes, '/companion/api', '/model')
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  const data = result.json.data
  assert.equal(data.canSave, true)
  assert.equal(data.llm, true)
  assert.deepEqual(data.current, { provider: 'deepseek-web', model: 'deepseek-chat' })
  assert.equal(data.groups.length, 1, '成功来源只有一条')
  assert.deepEqual(data.groups[0].models.map(function (item) { return item.id }), ['deepseek-chat', 'deepseek-reasoner'])
  assert.deepEqual(data.groups[0].models[1].reasoning.efforts.map(function (item) { return item.id }), ['low', 'high'])
  assert.equal(data.failures.length, 1, '坏来源必须进 failures 而不是整包失败')
  assert.equal(data.failures[0].id, 'broken')
  assert.deepEqual(data.routableProviders, ['deepseek-web'])
})

test('dashboard: 切换默认模型走 saveSelection 并回读', async function () {
  const { env, state } = makeModelEnv()
  const ok = await callHandler(env.routes, '/companion/api', '/model', {
    method: 'POST',
    body: { provider: 'deepseek-web', model: 'deepseek-reasoner', reasoningEffort: 'high' },
  })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.data.saved, true)
  assert.deepEqual(state.saved, { provider: 'deepseek-web', model: 'deepseek-reasoner', reasoningEffort: 'high' })
  assert.equal(state.saves, 1)
  assert.deepEqual(ok.json.data.current, { provider: 'deepseek-web', model: 'deepseek-reasoner', reasoningEffort: 'high' })

  const unknown = await callHandler(env.routes, '/companion/api', '/model', { method: 'POST', body: { provider: 'deepseek-web', model: 'nope' } })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.error, 'unknown-model')
  assert.equal(state.saves, 1, '校验不过不得写盘')

  const missing = await callHandler(env.routes, '/companion/api', '/model', { method: 'POST', body: { provider: 'deepseek-web' } })
  assert.equal(missing.status, 400)
  assert.equal(missing.json.error, 'provider-and-model-required')
})

test('dashboard: 没有 agentDefaultModel 时只读不写', async function () {
  const env = makeCtx()
  dashboard.apply(env.ctx, {})
  const read = await callHandler(env.routes, '/companion/api', '/model')
  assert.equal(read.status, 200)
  assert.equal(read.json.data.canSave, false)
  const write = await callHandler(env.routes, '/companion/api', '/model', { method: 'POST', body: { provider: 'a', model: 'b' } })
  assert.equal(write.status, 409)
  assert.equal(write.json.error, 'agentDefaultModel-unavailable')
})

test('dashboard: 免费链路读 our-free-model 的 combos', async function () {
  const env = makeCtx()
  mkdirSync(join(home, 'our-free-model'), { recursive: true })
  writeFileSync(join(home, 'our-free-model', 'settings.json'), JSON.stringify({
    version: 1,
    combos: [
      { name: 'free', strategy: 'round-robin', models: ['codearts/GLM-5.2', 'codebuddy/x'] },
      { name: '', models: ['ignored/y'] },
    ],
  }))
  dashboard.apply(env.ctx, {})
  const result = await callHandler(env.routes, '/companion/api', '/combos')
  assert.equal(result.status, 200)
  const data = result.json.data
  assert.equal(data.combos.length, 1, '空名链路要过滤')
  assert.equal(data.combos[0].name, 'free')
  assert.equal(data.combos[0].strategy, 'round-robin')
  assert.deepEqual(data.combos[0].models, ['codearts/GLM-5.2', 'codebuddy/x'])
  writeFileSync(join(home, 'our-free-model', 'settings.json'), JSON.stringify({ combos: [] }))
})

test('dashboard: 改默认模型时热切活跃会话', async function () {
  const { env, state } = makeModelEnv()
  const listened = []
  const agent = {
    session: { id: 'session-smoke-1' },
    ctx: { on(event) { listened.push(event); return function () {} } },
  }
  env.ctx.agents = { list() { return [agent] } }
  const ok = await callHandler(env.routes, '/companion/api', '/model', { method: 'POST', body: { provider: 'deepseek-web', model: 'deepseek-reasoner' } })
  assert.equal(ok.status, 200)
  assert.equal(state.saves, 1)
  const hot = ok.json.data.hotSwitch
  assert.equal(hot.total, 1, '一个活跃会话')
  if (hot.supported) {
    assert.equal(hot.switched, 1)
    assert.ok(listened.includes('system-prompt/assemble'), '要装上组装钩子')
    assert.ok(listened.includes('agent/request'), '要装上路由钩子')
  } else {
    assert.equal(hot.reason, 'dsh-agent-unavailable', '解析不到 dsh-agent 时只能退化，不能崩')
  }
  delete env.ctx.agents
})

test('dashboard: 值班 profile 体检 + 写值班默认模型', async function () {
  const env = makeCtx()
  dashboard.apply(env.ctx, {})
  const prof = join(home, 'profiles', 'headless')
  mkdirSync(prof, { recursive: true })
  writeFileSync(join(prof, 'package.json'), JSON.stringify({ name: 'headless', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-our-free-model'] } }, dependencies: { 'dsh-our-free-model': '^2.1.0' } }))
  writeFileSync(join(prof, 'cordis.patch.yml'), '# 注释要保住\n- id: agent-default-model\n  config:\n    provider: deepseek-web\n    model: deepseek-reasoner\n')
  mkdirSync(join(home, 'bili-duty'), { recursive: true })
  writeFileSync(join(home, 'bili-duty', 'config.json'), JSON.stringify({ headlessProfile: 'headless', dutyProvider: '', dutyModel: '' }))

  const info = dashboard.dutyProfileInfo()
  assert.equal(info.profile, 'headless')
  assert.equal(info.exists, true)
  assert.deepEqual(info.bundles, ['@deepseek-ai/dsh-base', 'dsh-our-free-model'])
  assert.equal(info.defaults.provider, 'deepseek-web')
  assert.equal(info.defaults.model, 'deepseek-reasoner')

  const got = await callHandler(env.routes, '/companion/api', '/duty', { method: 'GET' })
  assert.equal(got.status, 200, 'GET /duty 要 200')
  assert.equal(got.json.data.defaults.provider, 'deepseek-web', '接口要透出值班 profile 的默认模型')

  const after = dashboard.writeDutyDefault('our-free-model', 'combo:free')
  assert.equal(after.defaults.provider, 'our-free-model')
  assert.equal(after.defaults.model, 'combo:free')
  const written = readFileSync(join(prof, 'cordis.patch.yml'), 'utf8')
  assert.ok(written.includes('combo:free'), '新模型要写进 patch')
  assert.ok(written.startsWith('# 注释要保住'), '其它内容要原样保留')
  assert.ok(existsSync(join(prof, 'cordis.patch.yml.bak')), '改前要留 .bak')

  const post = await callHandler(env.routes, '/companion/api', '/duty/default', { method: 'POST', body: { provider: 'deepseek-web', model: 'deepseek-chat' } })
  assert.equal(post.status, 200)
  assert.equal(post.json.data.defaults.model, 'deepseek-chat')

  const bad = await callHandler(env.routes, '/companion/api', '/duty/default', { method: 'POST', body: { provider: 'deepseek-web' } })
  assert.equal(bad.status, 400, '缺模型要 400')

  rmSync(join(home, 'profiles'), { recursive: true, force: true })
  assert.throws(function () { dashboard.writeDutyDefault('a', 'b') }, /no-such-profile/, '没有那个 profile 时要明确报错')
  rmSync(join(home, 'bili-duty'), { recursive: true, force: true })
})
after(function () {
  try { rmSync(home, { recursive: true, force: true }) } catch {}
})

test('dashboard: QQ 长回复按句号分条', async function () {
  const split = await import('../packages/dsh-companion-dashboard/lib/qq-split.js')
  assert.deepEqual(split.splitBySentence('好的。'), ['好的。'])
  assert.deepEqual(split.splitBySentence(''), [])
  const long = '第一句话说完了。第二句话也说完了！第三句呢？第四句大概是这样。第五句收尾。'
  const rows = split.splitBySentence(long, 20)
  assert.ok(rows.length >= 2, '超长必须拆成多条，实际 ' + rows.length)
  for (const row of rows) assert.ok(row.length <= 20, '每条不得超过上限：' + row)
  assert.equal(rows.join(''), long, '拆完拼回去必须等于原文')
  assert.deepEqual(split.splitBySentence('你吃饭了吗？今天天气怎么样？'), ['你吃饭了吗？', '今天天气怎么样？'], '一句话一条消息，不能攒着合并')
  assert.deepEqual(split.splitBySentence('好的。'), ['好的。'], '单句就是一条，哪怕很短')
  assert.deepEqual(split.splitBySentence('嗯。知道了。'), ['嗯。', '知道了。'], '短句也各发一条')
  const many = '一句。'.repeat(30)
  const grouped = split.splitBySentence(many)
  assert.ok(grouped.length <= split.MAX_MESSAGES, '句子太多要兜底合并，实际 ' + grouped.length)
  assert.equal(grouped.join(''), many, '合并后拼回仍等于原文')
  const oneLongSentence = '这一句话特别长'.repeat(10)
  const hard = split.splitBySentence(oneLongSentence, 20)
  assert.ok(hard.length > 1, '单句超长也要硬切')
  for (const row of hard) assert.ok(row.length <= 20)
  // 2026-11-01 真机回归：省略号不是句末、[表情: …] 不能被劈开、句子不许被均分粘回一条
  assert.deepEqual(split.splitBySentence('那 mi 八成是……米？还是秘密？'), ['那 mi 八成是……米？', '还是秘密？'], '省略号留在句子里')
  const tag = split.splitBySentence('说完了。[表情: 瞪大眼睛，难道说……]')
  assert.equal(tag.length, 1, '[表情: …] 必须整段保住，不能被切成「…」「]」')
  assert.ok(tag[0].includes('[表情: 瞪大眼睛，难道说……]'))
  assert.deepEqual(split.splitBySentence('一。二。三。四。'), ['一。', '二。', '三。', '四。'], '几句话就是几条，不许粘回一条')
  const quoted = split.splitBySentence('他说：“我走了。”然后我也走了。')
  assert.deepEqual(quoted, ['他说：“我走了。”然后我也走了。'], '引号里的句号不断句')
  // 2026-11-01 05:52 真机：回复停在「…能看网页」，turn/end 却是 completed，用户只收到半句
  const cutTail = '主人，这次我把范围也讲清楚：扫到的、真看字幕的、被我否掉的。' + '再补一句凑长度。'.repeat(12) + '这半年的插件都在给 AI 加感官、加手脚——能看网页'
  assert.equal(split.looksUnfinished(cutTail), true, '长回复没有句末符号 = 说到一半断了')
  assert.equal(split.looksUnfinished(cutTail + '。'), false, '正常收尾不算断')
  assert.equal(split.looksUnfinished(cutTail + '\n[表情: 得意]'), false, '表情标记收尾不算断')
  assert.equal(split.looksUnfinished('我记性好着呢'), false, '短句本来就不打句号')
  assert.equal(split.looksUnfinished(''), false)
})

test('dashboard: 主人号/朋友号 + 主动互动', async function () {
  const env = makeCtx()
  dashboard.apply(env.ctx, {})
  const first = await callHandler(env.routes, '/companion/api', '/interact', { method: 'GET' })
  assert.equal(first.status, 200, 'GET /interact 要 200')
  assert.deepEqual(first.json.data.owners, [], '默认没有主人号')
  assert.deepEqual(first.json.data.friends, [])
  assert.equal(first.json.data.proactive.enabled, false, '主动互动默认关')
  assert.equal(first.json.data.proactive.intervalMinutes, 90)
  assert.equal(first.json.data.proactive.windowStart, 9)
  assert.equal(first.json.data.proactive.windowEnd, 23)
  assert.equal(first.json.data.outbound.ok, false, '还没捕获出站管道')

  const saved = await callHandler(env.routes, '/companion/api', '/interact', {
    method: 'POST',
    body: { owners: ['2634024517', '2634024517', 'abc'], friends: ['3953927738'], proactive: { enabled: true, intervalMinutes: 30, windowStart: 8, windowEnd: 22, pool: ['在忙吗？', '  ', '喝水'] } },
  })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.json.data.owners, ['2634024517'], '重复与非法号码要过滤')
  assert.deepEqual(saved.json.data.friends, ['3953927738'])
  assert.equal(saved.json.data.proactive.enabled, true)
  assert.equal(saved.json.data.proactive.intervalMinutes, 30)
  assert.deepEqual(saved.json.data.proactive.pool, ['在忙吗？', '喝水'], '空台词要丢掉')
  assert.ok(saved.json.data.nextDueAt > 0, '开了且有主人号就该给出到期时间')

  const disk = JSON.parse(readFileSync(join(home, 'companion', 'settings.json'), 'utf8'))
  assert.deepEqual(disk.friends, ['3953927738'], '要落盘到 <DSH_HOME>/companion/settings.json')

  const partial = await callHandler(env.routes, '/companion/api', '/interact', { method: 'POST', body: { proactive: { enabled: false } } })
  assert.deepEqual(partial.json.data.owners, ['2634024517'], '局部更新不能把主人号冲掉')
  assert.equal(partial.json.data.proactive.intervalMinutes, 30)

  const send = await callHandler(env.routes, '/companion/api', '/interact/send', { method: 'POST', body: {} })
  assert.equal(send.status, 400, '没有出站管道时要明确报错，不能假装发了')
  assert.match(String(send.json && send.json.error), /出站管道/)

  const cross = { proactive: { windowStart: 22, windowEnd: 6 } }
  assert.equal(dashboard.inWindow(cross, new Date(2026, 0, 1, 23)), true, '跨零点时段要算在窗口内')
  assert.equal(dashboard.inWindow(cross, new Date(2026, 0, 1, 3)), true)
  assert.equal(dashboard.inWindow(cross, new Date(2026, 0, 1, 6)), false, '窗口右端不含')
  assert.equal(dashboard.inWindow(cross, new Date(2026, 0, 1, 12)), false)
  assert.equal(dashboard.nextDueAt({ owners: ['1'], proactive: { enabled: true, intervalMinutes: 30, lastSentAt: 1000 } }), 1000 + 30 * 60000 - 0, '上次发过就按间隔算下次')
  assert.equal(dashboard.nextDueAt({ owners: [], proactive: { enabled: true, intervalMinutes: 30, lastSentAt: 1000 } }), 0, '没主人号就不该有到期时间')

  rmSync(join(home, 'companion'), { recursive: true, force: true })
})

test('dashboard: 值班摘要推送到主人号（一句鱼说 + 最多 N 条）', async function () {
  const env = makeCtx()
  const dutyDir = join(home, 'bili-duty')
  mkdirSync(dutyDir, { recursive: true })
  writeFileSync(join(dutyDir, 'say.txt'), '额度用完了就该收手，今晚真正的新东西只有两三条。')
  writeFileSync(join(dutyDir, 'memory.jsonl'), [
    JSON.stringify({ t: '四层记忆库怎么搭', why: '讲清了检索分层', bv: 'BV1iZxB6MEbc', d: '2026-11-01' }),
    JSON.stringify({ t: '让规矩按话题送到眼前', why: '提示词注入的取舍很实用', bv: 'BV1chxz61EXU', d: '2026-11-01' }),
    JSON.stringify({ t: '用飞书在手机上批准任务', why: '远程审批一条链路', bv: 'BV1pFx16cE5B', d: '2026-11-01' }),
  ].join('\n'))
  dashboard.apply(env.ctx, {})

  const signals = dashboard.readDutySignals()
  assert.ok(signals.key !== '', '轮次指纹不能为空（用来判断是不是新的一轮）')
  assert.equal(signals.items.length, 3)

  const text = dashboard.composeDutyMessage(signals, 2)
  assert.ok(text.indexOf('额度用完了就该收手') >= 0, '要带上 say.txt 那句话')
  assert.equal(/[。！？\n\r]/.test(text), false, '整段不能带句末标点或换行，否则会被 QQ 分句拆成好几条')
  assert.equal((text.match(/bilibili\.com\/video\//g) || []).length, 2, '最多 N 条')
  assert.ok(text.indexOf('https://www.bilibili.com/video/BV1pFx16cE5B') >= 0, '取最近的条目')
  assert.equal(text.indexOf('BV1iZxB6MEbc'), -1, '超出 max 的更早条目不要')
  assert.ok(text.indexOf('（提示词注入的取舍很实用）') >= 0, '每条带一句理由')

  const got = await callHandler(env.routes, '/companion/api', '/interact', { method: 'GET' })
  assert.equal(got.status, 200)
  assert.ok(got.json.data.duty.key !== '', 'GET /interact 要带上值班轮次指纹')
  assert.equal(got.json.data.duty.preview, text, '预览就是真会发出去的那段')
  assert.equal(got.json.data.duty.pending.why, 'no-owner', '没主人号不推')
  assert.equal(got.json.data.proactive.dutyPush.enabled, true, '值班推送默认开')
  assert.equal(got.json.data.proactive.dutyPush.maxItems, 2)

  const saved = await callHandler(env.routes, '/companion/api', '/interact', {
    method: 'POST',
    body: { owners: ['2634024517'], proactive: { windowStart: 0, windowEnd: 23, dutyPush: { maxItems: 1, cooldownMinutes: 10 } } },
  })
  assert.equal(saved.status, 200)
  assert.equal(saved.json.data.proactive.dutyPush.maxItems, 1, '最多几条要能改')
  assert.equal(saved.json.data.proactive.dutyPush.cooldownMinutes, 10, '冷却分钟要能改')
  assert.deepEqual(saved.json.data.owners, ['2634024517'], '只改值班设置不能冲掉主人号')
  const after = await callHandler(env.routes, '/companion/api', '/interact', { method: 'GET' })
  assert.equal(after.json.data.proactive.dutyPush.maxItems, 1, '重新读取要看到新值')
  if (new Date().getHours() < 23) assert.equal(after.json.data.duty.pending.due, true, '有主人号又在时段内，新的一轮就该推')
  assert.equal(after.json.data.duty.preview, dashboard.composeDutyMessage(signals, 1), '预览按新的条数算')

  const cfg = dashboard.readCompanion()
  const noon = new Date(2026, 0, 1, 12, 0, 0)
  const withDuty = (patch, ppatch) => Object.assign({}, cfg, { proactive: Object.assign({}, cfg.proactive, { windowStart: 0, windowEnd: 23 }, ppatch || {}, { dutyPush: Object.assign({}, cfg.proactive.dutyPush, patch) }) })
  assert.equal(dashboard.dutyPushDue(withDuty({ enabled: false }), signals, noon).why, 'disabled')
  assert.equal(dashboard.dutyPushDue(withDuty({}, { windowEnd: 1 }), signals, noon).why, 'outside-window')
  assert.equal(dashboard.dutyPushDue(withDuty({ lastKey: signals.key, lastAt: 0 }), signals, noon).why, 'already-pushed')
  assert.equal(dashboard.dutyPushDue(withDuty({ lastKey: '', lastAt: noon.getTime() - 60000 }), signals, noon).why, 'cooling')
  assert.equal(dashboard.dutyPushDue(withDuty({ lastKey: '', lastAt: 0 }), signals, noon).due, true)

  const send = await callHandler(env.routes, '/companion/api', '/interact/send', { method: 'POST', body: { duty: true, force: true } })
  assert.equal(send.status, 400, '没有出站管道时推送要明确报错')
  assert.match(String(send.json && send.json.error), /出站管道/)

  rmSync(join(home, 'companion'), { recursive: true, force: true })
  rmSync(dutyDir, { recursive: true, force: true })
})

test('anima: 按来源撤销连带派生 + 证据不足进隔离区 + 哈希链账本报红', async function () {
  const env = makeCtx()
  anima.apply(env.ctx, {})
  const ledger = await import('../packages/dsh-anima/lib/ledger.js')
  const good = await env.tools.get('anima_memory_capture').execute({ text: '冒烟-有证据那条', source: 'smoke-src', evidence: 'BV1abcdefgh2 12:30' }, {})
  assert.match(good, /候选池/)
  assert.ok(!good.includes('证据不足'), '有证据不该进隔离区')
  const thin = await env.tools.get('anima_memory_capture').execute({ text: '冒烟-没证据那条', source: 'smoke-src' }, {})
  assert.match(thin, /证据不足/, '没证据要明确说进了隔离区')
  const goodId = good.match(/mem_[a-z0-9_]+/)[0]
  const thinId = thin.match(/mem_[a-z0-9_]+/)[0]
  const rows = JSON.parse(await env.tools.get('anima_memory_pending').execute({}, {})).filter(function (row) { return row.source === 'smoke-src' })
  assert.equal(rows.length, 2)
  assert.equal(rows.find(function (r) { return r.id === goodId }).quarantine, false)
  assert.equal(rows.find(function (r) { return r.id === thinId }).quarantine, true)
  await env.tools.get('anima_memory_decide').execute({ id: goodId, decision: 'approve' }, {})
  const derived = await env.tools.get('anima_memory_capture').execute({ text: '冒烟-由它推出来的那条', source: 'smoke-derived', evidence: '同上', derivedFrom: [goodId] }, {})
  const derivedId = derived.match(/mem_[a-z0-9_]+/)[0]
  await env.tools.get('anima_memory_decide').execute({ id: derivedId, decision: 'approve' }, {})
  const section = env.sections[0]
  assert.ok(section.text().includes('- [' + goodId + ']'), '撤销前应在索引里')
  const revoked = await env.tools.get('anima_memory_revoke').execute({ source: 'smoke-src', reason: '冒烟：记错了' }, {})
  assert.match(revoked, /已撤销 3 条/, '同来源两条 + 派生一条一起撤，实际：' + revoked)
  const detail = await env.tools.get('anima_memory_get').execute({ id: derivedId }, {})
  assert.match(detail, /不是已确认事实/, '派生条目必须跟着失效')
  assert.ok(!section.text().includes('- [' + goodId + ']'), '撤销后不得再进索引')
  assert.equal((await env.tools.get('anima_memory_revoke').execute({}, {})), '要撤销哪批？给 source（来源）或 id（单条）之一。')
  const audit = JSON.parse(await env.tools.get('anima_memory_audit').execute({}, {}))
  assert.equal(audit.ledger.ok, true, '正常链应通过')
  assert.ok(audit.ledger.entries >= 4, 'capture/decide/revoke 都要记账，实际 ' + audit.ledger.entries)
  assert.ok(audit.memory.byStatus.revoked >= 3)
  const snapshot = readFileSync(audit.ledger.path, 'utf8')
  const lines = snapshot.split('\n').filter(Boolean)
  const row = JSON.parse(lines[1])
  row.text = '冒烟-被改过'
  lines[1] = JSON.stringify(row)
  writeFileSync(audit.ledger.path, lines.join('\n') + '\n')
  const broken = JSON.parse(await env.tools.get('anima_memory_audit').execute({}, {}))
  assert.equal(broken.ledger.ok, false, '改一个字段必须报红')
  assert.match(JSON.stringify(broken.ledger.problems), /hash 不匹配/)
  writeFileSync(audit.ledger.path, snapshot)
})

test('dashboard: 表情包库纳入 QQ 媒体围栏（media.sendRoots）', async function () {
  const memes = join(home, 'meme-packs', 'maid-emoji', 'memes', 'happy')
  mkdirSync(memes, { recursive: true })
  writeFileSync(join(memes, 'xinhuanufang.png'), 'fake-png')
  const mediaRoots = await import('../packages/dsh-companion-dashboard/lib/media-roots.js')

  const plain = mediaRoots.extraMediaRoots()
  assert.ok(plain.includes(realpathSync.native(join(home, 'meme-packs'))), '默认必须把 <DSH_HOME>/meme-packs 放行，实际 ' + JSON.stringify(plain))
  const status = mediaRoots.mediaRootsStatus()
  assert.equal(status.count, plain.length)
  assert.deepEqual(status.roots, plain)

  mkdirSync(join(home, 'extra-media'), { recursive: true })
  mkdirSync(join(home, 'companion'), { recursive: true })
  writeFileSync(join(home, 'companion', 'settings.json'), JSON.stringify({
    media: { extraRoots: [join(home, 'extra-media'), 'relative/dir', join(home, 'not-here')] },
  }))
  const withExtra = mediaRoots.extraMediaRoots()
  assert.ok(withExtra.includes(realpathSync.native(join(home, 'extra-media'))), '设置里的绝对目录要放行')
  assert.equal(withExtra.some(function (row) { return row.indexOf('relative') >= 0 }), false, '相对路径要忽略')
  assert.equal(withExtra.some(function (row) { return row.indexOf('not-here') >= 0 }), false, '不存在的目录要过滤')

  const install = await mediaRoots.installMediaRoots()
  assert.equal(typeof install.ok, 'boolean', '装不上也不能抛，要给结构化的结果')
  if (!install.ok) assert.ok(['no-bridge-module', 'no-mediaSendRoots'].includes(install.reason), '结构变了要说明原因：' + install.reason)

  const env = makeCtx()
  dashboard.apply(env.ctx, {})
  const route = await callHandler(env.routes, '/companion/api', '/media-roots', { method: 'GET' })
  assert.equal(route.status, 200, 'GET /media-roots 要 200')
  assert.ok(Array.isArray(route.json.roots), '要回 roots 数组')
  assert.equal(route.json.count, route.json.roots.length)
  assert.ok(route.json.roots.includes(realpathSync.native(join(home, 'meme-packs'))), '接口里也要看到表情包库')

  rmSync(join(home, 'companion'), { recursive: true, force: true })
  rmSync(join(home, 'meme-packs'), { recursive: true, force: true })
  rmSync(join(home, 'extra-media'), { recursive: true, force: true })
})

test('dashboard: 切换模型下发到 QQ 各聊天（chat-model）', async () => {
  const chatModel = await import('../packages/dsh-companion-dashboard/lib/chat-model.js')
  const next = { provider: 'deepseek-account', model: 'deepseek-flash' }

  // 纯函数：只改 selectionRef.current（与 dsh-onebot-qq/lib/commands.js:331 的 /model 一致）
  const used = { current: { provider: 'raccoon', model: 'old' } }
  const noRef = { chatId: 'group:1' }
  const out = chatModel.retargetChats(new Map([['private:1', { selectionRef: used }], ['group:1', noRef]]), next)
  assert.equal(out.switched, 1, '有 selectionRef 的聊天被改')
  assert.equal(out.skipped, 1, '没有 selectionRef 的聊天跳过')
  assert.deepEqual(out.chatIds, ['private:1'])
  assert.deepEqual(used.current, next, '写进去的就是新选择')
  assert.equal(noRef.selectionRef, undefined, '不能凭空给聊天加 selectionRef')

  // 数组形态也要认（诊断侧可能传行数组）
  const arr = chatModel.retargetChats([{ chatId: 'private:2', selectionRef: { current: {} } }], next)
  assert.equal(arr.switched, 1)
  assert.deepEqual(arr.chatIds, ['private:2'])

  // 没有 onebot 模块时不能抛，要给结构化原因
  const install = await chatModel.installChatModel()
  assert.equal(typeof install.ok, 'boolean', '装不上也要有结果')
  if (!install.ok) assert.ok(['no-onebot-module', 'import-failed', 'no-createChatAgent'].includes(install.reason), '结构变了要说明原因：' + install.reason)

  const status = chatModel.chatModelStatus(null)
  assert.equal(status.ok, true)
  assert.equal(status.captured, false, '测试环境没有 bridge 实例 ⇒ 未捕获')
  assert.equal(Array.isArray(status.chats), true)

  const live = chatModel.retargetLiveChats(null, next)
  assert.equal(live.ok, false, '没有聊天表时不能假装成功')
  assert.ok(['no-chat-yet', 'no-chat-registry'].includes(live.reason), '要给出原因：' + live.reason)
  assert.equal(live.switched, 0)

  // 导出的接口在
  const dashboard = await import('../packages/dsh-companion-dashboard/lib/index.js')
  for (const name of ['installChatModel', 'chatModelStatus', 'retargetLiveChats', 'currentBridge']) {
    assert.equal(typeof dashboard[name] !== 'undefined', true, '要导出 ' + name)
  }
})


test('dashboard: [表情: 描述] 在 QQ 通道换成真图（meme-inline）', async () => {
  const meme = await import('../packages/dsh-companion-dashboard/lib/meme-inline.js')

  const one = meme.takeMemeMarkers('好耶[表情: 开心]那就这样吧')
  assert.equal(one.text, '好耶那就这样吧', '标记要从正文里摘掉')
  assert.deepEqual(one.captions, ['开心'])

  const full = meme.takeMemeMarkers('好吧[表情：无奈]')
  assert.deepEqual(full.captions, ['无奈'], '全角冒号也要认')
  assert.equal(full.text, '好吧')

  const two = meme.takeMemeMarkers('[表情: 开心][表情: 无语]')
  assert.deepEqual(two.captions, ['开心', '无语'])
  assert.equal(two.text, '', '只有标记时正文应为空')

  const none = meme.takeMemeMarkers('一句普通的话')
  assert.deepEqual(none.captions, [])
  assert.equal(none.text, '一句普通的话')

  const status = meme.memeInlineStatus()
  assert.equal(typeof status.ok, 'boolean')
  assert.equal(Array.isArray(status.packs), true)
  assert.equal(status.marker, true)

  // 测试环境没有图库 ⇒ 找不回路径，也绝不能抛；发不出去的退回 missed 让调用方拼回文字
  const calls = []
  const fakeBridge = { sendMsg: async (chatId, segments) => { calls.push({ chatId, segments }); return 'id-1' } }
  const result = await meme.sendMemeImages(fakeBridge, 'private:1', ['图库里没有的描述'])
  assert.deepEqual(result.sent, [])
  assert.deepEqual(result.missed, ['图库里没有的描述'])
  assert.equal(calls.length, 0, '找不到图就不该发空消息')

  const dashboard = await import('../packages/dsh-companion-dashboard/lib/index.js')
  assert.equal(typeof dashboard.memeInlineStatus !== 'undefined', true, '要让面板看到状态')
})


test('dashboard: 主动互动按星期几排班（周1234567）', async function () {
  const env = makeCtx()
  dashboard.apply(env.ctx, {})
  const first = await callHandler(env.routes, '/companion/api', '/interact', { method: 'GET' })
  assert.equal(first.status, 200)
  assert.deepEqual(first.json.data.proactive.days, [1, 2, 3, 4, 5, 6, 7], '默认每天都发')

  const saved = await callHandler(env.routes, '/companion/api', '/interact', {
    method: 'POST',
    body: { owners: ['2634024517'], proactive: { enabled: true, days: [5, '3', 3, 9, 0, 'x', 1] } },
  })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.json.data.proactive.days, [1, 3, 5], '只认 1-7，去重并升序')

  const disk = JSON.parse(readFileSync(join(home, 'companion', 'settings.json'), 'utf8'))
  assert.deepEqual(disk.proactive.days, [1, 3, 5], '要落盘')

  const cleared = await callHandler(env.routes, '/companion/api', '/interact', { method: 'POST', body: { proactive: { days: [] } } })
  assert.deepEqual(cleared.json.data.proactive.days, [1, 2, 3, 4, 5, 6, 7], '一天都不选按全周算，别静默不发')

  const keep = await callHandler(env.routes, '/companion/api', '/interact', { method: 'POST', body: { proactive: { intervalMinutes: 45 } } })
  assert.deepEqual(keep.json.data.proactive.days, [1, 2, 3, 4, 5, 6, 7], '只改间隔不能冲掉星期')

  assert.deepEqual(dashboard.normalizeDays([7, 2, 2]), [2, 7])
  const mon = new Date(2026, 10, 2, 10, 0, 0)
  const sun = new Date(2026, 10, 1, 10, 0, 0)
  const weekdays = { proactive: { days: [1, 2, 3, 4, 5] } }
  assert.equal(dashboard.inActiveDay(weekdays, mon), true, '周一在 [1-5] 里')
  assert.equal(dashboard.inActiveDay(weekdays, sun), false, '周日不在 [1-5] 里')
  assert.equal(dashboard.inActiveDay({ proactive: { days: [7] } }, sun), true, '周日编号是 7，不是 0')
  assert.equal(dashboard.inActiveDay({ proactive: {} }, sun), true, '没配过 = 全周')

  const dutyOff = dashboard.dutyPushDue(
    { owners: ['2634024517'], proactive: { days: [1], dutyPush: { enabled: true, maxItems: 2, cooldownMinutes: 30, lastKey: '', lastAt: 0 } } },
    { key: 'k1', items: [{ bv: 'BV1', title: 't', reason: 'r' }], say: '一句鱼说' },
    new Date(2026, 10, 3, 10, 0, 0),
  )
  assert.equal(dutyOff.due, false, '周二不在排班日')
  assert.equal(dutyOff.why, 'outside-day')

  rmSync(join(home, 'companion'), { recursive: true, force: true })
})

test('dashboard: 鱼塘自动运行按星期开（pond-gate 停放/归还）', async function () {
  const pond = join(home, 'bili-duty')
  mkdirSync(pond, { recursive: true })
  const cfgPath = join(pond, 'config.json')
  const mon = new Date(2026, 10, 2, 10, 0, 0)
  const sun = new Date(2026, 10, 1, 10, 0, 0)

  assert.equal(typeof dashboard.applyPondGate, 'function', '要导出 applyPondGate')
  assert.equal(typeof dashboard.pondGateStatus, 'function', '要导出 pondGateStatus')

  const mod = await import('../packages/dsh-companion-dashboard/lib/pond-gate.js')
  assert.deepEqual(mod.normalizeDays([]), [1, 2, 3, 4, 5, 6, 7], '空 = 全周')
  assert.deepEqual(mod.normalizeDays([7, '2', 2, 0, 9]), [2, 7], '只认 1-7')
  assert.equal(mod.dayAllowed([7], sun), true, '周日编号是 7')
  assert.equal(mod.dayAllowed([1, 2, 3, 4, 5], sun), false)

  assert.equal(mod.pondGateDecision({ days: [1, 2, 3, 4, 5], autoRun: true, parked: false, date: sun }).action, 'park', '非排班日 + 开着 ⇒ 停')
  assert.equal(mod.pondGateDecision({ days: [1, 2, 3, 4, 5], autoRun: true, parked: true, date: sun }).action, 'none', '已经停过就别重复动')
  assert.equal(mod.pondGateDecision({ days: [1, 2, 3, 4, 5], autoRun: true, parked: true, date: mon }).action, 'restore', '排班日 + 是我们停的 ⇒ 还回开')
  assert.equal(mod.pondGateDecision({ days: [1, 2, 3, 4, 5], autoRun: true, parked: false, date: mon }).action, 'none', '排班日不动')
  const off = mod.pondGateDecision({ days: [7], autoRun: false, parked: false, date: mon })
  assert.equal(off.action, 'none', '本来就关着 ⇒ 绝不替用户打开')
  assert.equal(off.why, 'already-off')

  writeFileSync(cfgPath, JSON.stringify({ autoRun: true, perDay: 5, mentionName: '主人' }, null, 2), 'utf8')
  const parked = mod.applyPondGate({ days: [1, 2, 3, 4, 5], parked: false, date: sun })
  assert.equal(parked.ok, true)
  assert.equal(parked.action, 'park')
  assert.equal(parked.parked, true)
  const afterPark = JSON.parse(readFileSync(cfgPath, 'utf8'))
  assert.equal(afterPark.autoRun, false, '非排班日真的把鱼塘关掉')
  assert.equal(afterPark.perDay, 5, '只改 autoRun，别冲掉别的配置')
  assert.ok(existsSync(join(pond, 'local-override.json')), '要写 local-override.json 让 config.json 本地优先')
  assert.ok(JSON.parse(readFileSync(join(pond, 'local-override.json'), 'utf8')).autoRun > 0)

  const restored = mod.applyPondGate({ days: [1, 2, 3, 4, 5], parked: true, date: mon })
  assert.equal(restored.action, 'restore')
  assert.equal(restored.parked, false)
  assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).autoRun, true, '排班日还回开')

  writeFileSync(cfgPath, JSON.stringify({ autoRun: false, perDay: 5 }, null, 2), 'utf8')
  const untouched = mod.applyPondGate({ days: [1, 2, 3, 4, 5], parked: false, date: sun })
  assert.equal(untouched.changed, false, '本来就关着：一次都不该写盘')
  assert.equal(JSON.parse(readFileSync(cfgPath, 'utf8')).autoRun, false)

  const env = makeCtx()
  dashboard.apply(env.ctx, {})
  const got = await callHandler(env.routes, '/companion/api', '/pond-gate', { method: 'GET' })
  assert.equal(got.status, 200)
  assert.equal(got.json.data.gate, false, '默认不开，别偷偷接管鱼塘')
  assert.deepEqual(got.json.data.days, [1, 2, 3, 4, 5, 6, 7])
  assert.equal(typeof got.json.data.autoRun, 'boolean')
  assert.ok(String(got.json.data.dir).endsWith('bili-duty'))

  const on2 = await callHandler(env.routes, '/companion/api', '/pond-gate', { method: 'POST', body: { gate: true, days: [5, '3', 9, 0] } })
  assert.equal(on2.status, 200)
  assert.equal(on2.json.data.gate, true)
  assert.deepEqual(on2.json.data.days, [3, 5], 'post 也要净化星期')
  const companion = JSON.parse(readFileSync(join(home, 'companion', 'settings.json'), 'utf8'))
  assert.equal(companion.proactive.pond.gate, true, '要落盘')
  assert.deepEqual(companion.proactive.pond.days, [3, 5])

  const off2 = await callHandler(env.routes, '/companion/api', '/pond-gate', { method: 'POST', body: { gate: false } })
  assert.equal(off2.json.data.gate, false)
  assert.deepEqual(off2.json.data.days, [3, 5], '只关闸门不该冲掉星期')

  rmSync(pond, { recursive: true, force: true })
  rmSync(join(home, 'companion'), { recursive: true, force: true })
})
