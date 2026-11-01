/**
 * 测试专用解析钩子：把 @deepseek-ai/* 映射到本机 DSH 运行时自带的同名包。
 * 只是为了让冒烟测试在本仓库里跑起来——真实 DSH 进程自己负责这层解析。
 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const RUNTIME = process.env.DSH_RUNTIME_DIR
  || 'D:\\DeepSeek-Harness\\npm-global\\node_modules\\@deepseek-ai\\dsh\\node_modules\\@deepseek-ai'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@deepseek-ai/')) {
    try {
      return await nextResolve(specifier, context)
    } catch (error) {
      const name = specifier.slice('@deepseek-ai/'.length)
      const base = join(RUNTIME, name)
      for (const rel of ['lib/index.js', 'index.js']) {
        const candidate = join(base, rel)
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true }
      }
      throw error
    }
  }
  return nextResolve(specifier, context)
}
