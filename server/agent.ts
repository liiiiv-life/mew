import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const exec = promisify(execFile)
const HERMES_BIN = path.join(homedir(), '.local', 'bin', 'hermes')
const DOCS_CWD = path.join(homedir(), 'dev', 'liiiiv')
const PROVIDER = 'headroom'
const DEFAULT_MODEL = 'google/gemini-3.1-flash-lite'
const HERMES_HOME = path.join(homedir(), '.hermes')
const STATE_DB = path.join(HERMES_HOME, 'state.db')
const SKILLS_DIR = path.join(HERMES_HOME, 'skills')
const MODELS_CACHE = path.join(HERMES_HOME, 'provider_models_cache.json')

export interface AgentSession {
  id: string
  title: string | null
  startedAt: number
  lastActiveAt: number
  messageCount: number
}

export interface AgentMessage {
  role: 'user' | 'assistant'
  content: string
}

interface CallResult {
  text: string
  sessionId: string | null
}

async function callHermes(
  prompt: string,
  opts: { skill?: string; resume?: string; model?: string; timeoutMs?: number } = {},
): Promise<CallResult> {
  const args = ['chat', '-Q', '-q', prompt, '--provider', PROVIDER, '-m', opts.model || DEFAULT_MODEL]
  if (opts.skill) args.push('-s', opts.skill)
  if (opts.resume) args.push('--resume', opts.resume)

  const { stdout, stderr } = await exec(HERMES_BIN, args, {
    cwd: DOCS_CWD,
    timeout: opts.timeoutMs ?? 120_000,
    env: { ...process.env, HERMES_HOME },
    maxBuffer: 10 * 1024 * 1024,
  })

  // strip terminal escape codes and control chars; keep readable text only
  const clean = stdout
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/[\r\u0007]/g, '')
    .replace(/^\s*─+\s*⚕ Hermes\s*─+\s*/m, '')
    .split('\n')
    .filter((l) => !/^(\s*─+\s*$|Query:)/.test(l))
    .join('\n')
    .trim()

  // quiet mode reports the session on stderr: "session_id: <id>"
  const sessionId = /session_id:\s*(\S+)/.exec(stderr)?.[1] ?? opts.resume ?? null

  return { text: clean || '(no response)', sessionId }
}

export async function fileInbox(): Promise<string> {
  const { text } = await callHermes('.new/ 인박스를 정리해주세요. /newdocs 스킬을 사용하세요.', {
    skill: 'newdocs',
    timeoutMs: 120_000,
  })
  return text
}

export async function agentChat(
  prompt: string,
  opts: { sessionId?: string; skill?: string; model?: string } = {},
): Promise<CallResult> {
  return callHermes(prompt, {
    resume: opts.sessionId,
    skill: opts.skill,
    model: opts.model,
    timeoutMs: 120_000,
  })
}

function openStateDb(): DatabaseSync {
  return new DatabaseSync(STATE_DB, { readOnly: true })
}

export function listAgentSessions(limit = 30): AgentSession[] {
  const db = openStateDb()
  try {
    const rows = db
      .prepare(
        `SELECT id, title, started_at, COALESCE(ended_at, started_at) AS last_active, message_count
         FROM sessions
         WHERE source = 'cli' AND (archived IS NULL OR archived = 0)
         ORDER BY last_active DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{ id: string; title: string | null; started_at: number; last_active: number; message_count: number }>
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      startedAt: r.started_at,
      lastActiveAt: r.last_active,
      messageCount: r.message_count,
    }))
  } finally {
    db.close()
  }
}

export function getAgentSessionMessages(sessionId: string): AgentMessage[] {
  const db = openStateDb()
  try {
    return db
      .prepare(
        `SELECT role, content FROM messages
         WHERE session_id = ? AND role IN ('user', 'assistant') AND content != '' AND active = 1
         ORDER BY id`,
      )
      .all(sessionId) as unknown as AgentMessage[]
  } finally {
    db.close()
  }
}

export function listAgentModels(): { default: string; models: string[] } {
  // headroom은 OpenRouter 프록시이므로 hermes의 openrouter 모델 캐시를 그대로 쓴다
  let models: string[] = []
  try {
    const cache = JSON.parse(fs.readFileSync(MODELS_CACHE, 'utf-8')) as Record<
      string,
      { models?: string[] }
    >
    models = cache.openrouter?.models ?? []
  } catch {
    // 캐시가 없으면 기본 모델만 노출
  }
  if (!models.includes(DEFAULT_MODEL)) models = [DEFAULT_MODEL, ...models]
  return { default: DEFAULT_MODEL, models }
}

export function listAgentSkills(): string[] {
  // a skill is any directory holding a SKILL.md, either at the top level or one category level down
  const names = new Set<string>()
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = path.join(SKILLS_DIR, entry.name)
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
      names.add(entry.name)
      continue
    }
    for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
      if (sub.isDirectory() && fs.existsSync(path.join(dir, sub.name, 'SKILL.md'))) names.add(sub.name)
    }
  }
  return [...names].sort()
}
