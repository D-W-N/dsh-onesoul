import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function animaDir() {
  return join(dshHome(), 'anima')
}

export function personaPath() {
  return join(animaDir(), 'persona.json')
}

export function memoryPath() {
  return join(animaDir(), 'memory.json')
}

export function settingsPath() {
  return join(animaDir(), 'settings.json')
}

export function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + randomUUID().slice(0, 8)
}

export function nowIso() {
  return new Date().toISOString()
}

/** Read a JSON file, returning fallback when it is missing or unparseable. */
export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback
    return fallback
  }
}

/** Sync twin used by the system-prompt provider, which must stay synchronous. */
export function readJsonSync(path, fallback) {
  try {
    const raw = readFileSync(path, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function stampOf(path) {
  try {
    const info = statSync(path)
    return info.mtimeMs + ':' + info.size
  } catch {
    return 'missing'
  }
}

/** Write JSON atomically: tmp file in the same directory, then rename. */
export async function writeJson(path, value) {
  await mkdir(animaDir(), { recursive: true })
  const tmp = path + '.' + process.pid + '.tmp'
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(tmp, path)
}

export function ensureDirSync() {
  mkdirSync(animaDir(), { recursive: true })
}
