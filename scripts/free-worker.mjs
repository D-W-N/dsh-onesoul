#!/usr/bin/env node
/**
 * 免费模型打工器：把一段提示词交给本机 OpenAI 兼容网关（dsh-our-free-model），
 * 拿回结果；按顺序在多个模型间回退，全部失败才报错。
 *
 * 用法：
 *   node scripts/free-worker.mjs --in prompt.md --out out.txt
 *   node scripts/free-worker.mjs --in prompt.md --strip-fence --out lib/x.js
 *   node scripts/free-worker.mjs --in prompt.md --model buddy/deepseek-v4.1-flash --max-tokens 4000
 *
 * 退出码：0 成功（结果写到 --out 或 stdout）；1 全部模型失败；2 参数/环境错误。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_MODELS = ['cline/openrouter/free', 'buddy/deepseek-v4.1-flash', 'loomy/auto']
const GATEWAY = process.env.OUR_FREE_MODEL_URL || 'http://127.0.0.1:8326/v1'

function parseArgs(argv) {
  const out = { models: [], maxTokens: 12000, temperature: 0.3, timeoutMs: 180000, stripFence: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      const v = argv[i + 1]
      if (v === undefined) throw new Error(`参数 ${a} 缺值`)
      i += 1
      return v
    }
    if (a === '--in') out.input = next()
    else if (a === '--out') out.output = next()
    else if (a === '--system') out.system = next()
    else if (a === '--model') out.models = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--max-tokens') out.maxTokens = Number(next())
    else if (a === '--temperature') out.temperature = Number(next())
    else if (a === '--timeout') out.timeoutMs = Number(next())
    else if (a === '--strip-fence') out.stripFence = true
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`不认识的参数：${a}`)
  }
  if (!out.models.length) out.models = DEFAULT_MODELS.slice()
  return out
}

function readKey() {
  if (process.env.OUR_FREE_MODEL_KEY) return process.env.OUR_FREE_MODEL_KEY.trim()
  const home = (process.env.DSH_HOME || '').trim() || join(homedir(), '.dsh')
  const candidates = [join(home, 'openai-gateway', 'api-key'), 'D:/DSH/.dsh/openai-gateway/api-key']
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  }
  throw new Error(`找不到网关 key，试过：${candidates.join(' , ')}`)
}

function stripFence(text) {
  const m = text.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/)
  if (m) return m[1].replace(/\s+$/, '\n')
  return text.replace(/^\s*```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```\s*$/, '')
}

async function callModel(model, { system, user, maxTokens, temperature, timeoutMs }) {
  const body = {
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    temperature,
    stream: false,
  }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(`${GATEWAY}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${readKey()}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = null }
    if (!res.ok || !json) {
      const msg = json?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`
      return { ok: false, code: json?.error?.code || `HTTP${res.status}`, message: msg }
    }
    const content = json.choices?.[0]?.message?.content
    if (!content || !content.trim()) {
      return { ok: false, code: 'EMPTY', message: '模型返回空内容（往往是 max_tokens 被思考吃光）' }
    }
    return { ok: true, content, usage: json.usage || {} }
  } catch (err) {
    return { ok: false, code: 'NETWORK', message: String(err && err.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write('node scripts/free-worker.mjs --in <prompt> [--out <file>] [--model m1,m2] [--system <file>] [--max-tokens N] [--strip-fence]\n')
    return 0
  }
  if (!args.input) throw new Error('缺 --in <promptFile>')
  const user = readFileSync(args.input, 'utf8')
  const system = args.system ? readFileSync(args.system, 'utf8') : undefined
  const failures = []
  for (const model of args.models) {
    let attempt = 0
    let budget = args.maxTokens
    for (;;) {
      attempt += 1
      const t0 = Date.now()
      const r = await callModel(model, { system, user, maxTokens: budget, temperature: args.temperature, timeoutMs: args.timeoutMs })
      const ms = Date.now() - t0
      if (r.ok) {
        const content = args.stripFence ? stripFence(r.content) : r.content
        if (args.output) {
          writeFileSync(args.output, content, 'utf8')
          process.stderr.write(`[worker] ${model} ✓ ${ms}ms usage=${r.usage.total_tokens || '?'} → ${args.output} (${content.length} 字)\n`)
        } else {
          process.stderr.write(`[worker] ${model} ✓ ${ms}ms usage=${r.usage.total_tokens || '?'}\n`)
          process.stdout.write(content)
        }
        return 0
      }
      if (r.code === 'EMPTY' && attempt === 1 && budget < 32000) {
        budget *= 2
        process.stderr.write(`[worker] ${model} EMPTY → 加倍 max_tokens 到 ${budget} 重试\n`)
        continue
      }
      failures.push(`${model}: ${r.code} ${r.message}`)
      process.stderr.write(`[worker] ${model} ✗ ${r.code} ${r.message.slice(0, 120)} (${ms}ms)\n`)
      break
    }
  }
  process.stderr.write(`[worker] 所有模型都失败：\n  ${failures.join('\n  ')}\n`)
  return 1
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`[worker] ${err && err.message || err}\n`)
  process.exit(2)
})
