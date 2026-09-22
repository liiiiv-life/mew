import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './dataDir.ts'

export const AGENT_GUIDANCE_PATH = path.join(DATA_DIR, 'agent-guidance.txt')
const template = new URL('./prompts/agent-guidance.txt', import.meta.url)

/** Publish a complete seed atomically; concurrent hosts never replace an existing file. */
export function ensureAgentGuidance(): string {
  try { fs.lstatSync(AGENT_GUIDANCE_PATH); return AGENT_GUIDANCE_PATH }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  const temporaryDir = fs.mkdtempSync(path.join(DATA_DIR, '.agent-guidance-'))
  const temporary = path.join(temporaryDir, 'seed')
  try {
    fs.writeFileSync(temporary, fs.readFileSync(template), { mode: 0o600 })
    try { fs.linkSync(temporary, AGENT_GUIDANCE_PATH) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  } finally { fs.rmSync(temporaryDir, { recursive: true, force: true }) }
  return AGENT_GUIDANCE_PATH
}

/** No cache: edits apply to the next request. Preview alone does not create state. */
export function readAgentGuidance(): string {
  try { return fs.readFileSync(AGENT_GUIDANCE_PATH, 'utf8').trim() }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return fs.readFileSync(template, 'utf8').trim()
  }
}
