import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const exec = promisify(execFile)

export type AgentProvider = 'hermes' | 'claude'

const HERMES_BIN = path.join(homedir(), '.local', 'bin', 'hermes')
const CLAUDE_BIN = path.join(homedir(), '.local', 'bin', 'claude')
const DOCS_CWD = path.join(homedir(), 'dev', 'liiiiv')

const HEADROOM_PROVIDER = 'headroom'
const DEFAULT_HERMES_MODEL = 'google/gemini-3.1-flash-lite'
const HERMES_HOME = path.join(homedir(), '.hermes')
const STATE_DB = path.join(HERMES_HOME, 'state.db')
const HERMES_SKILLS_DIR = path.join(HERMES_HOME, 'skills')
const MODELS_CACHE = path.join(HERMES_HOME, 'provider_models_cache.json')

const DEFAULT_CLAUDE_MODEL = 'sonnet'
const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku']
const CLAUDE_HOME = path.join(homedir(), '.claude')
const CLAUDE_SKILLS_DIR = path.join(CLAUDE_HOME, 'skills')
// Claude Code keys session transcripts by cwd, encoded as the absolute path with '/' -> '-'
const CLAUDE_PROJECT_DIR = path.join(CLAUDE_HOME, 'projects', DOCS_CWD.replace(/\//g, '-'))
// docs-editor's own record of sessions it created — Claude Code has no equivalent to Hermes'
// state.db "source = 'cli'" filter, so we track just the ones started from this app.
const CLAUDE_SESSIONS_REGISTRY = path.join(homedir(), '.docs-editor', 'claude-sessions.json')

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
  const args = ['chat', '-Q', '-q', prompt, '--provider', HEADROOM_PROVIDER, '-m', opts.model || DEFAULT_HERMES_MODEL]
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
    .replace(/[\r]/g, '')
    .replace(/^\s*─+\s*⚕ Hermes\s*─+\s*/m, '')
    .split('\n')
    .filter((l) => !/^(\s*─+\s*$|Query:)/.test(l))
    .join('\n')
    .trim()

  // quiet mode reports the session on stderr: "session_id: <id>"
  const sessionId = /session_id:\s*(\S+)/.exec(stderr)?.[1] ?? opts.resume ?? null

  return { text: clean || '(no response)', sessionId }
}

interface ClaudePrintResult {
  subtype: string
  is_error: boolean
  result?: string
  session_id: string
}

async function callClaude(
  prompt: string,
  opts: { skill?: string; resume?: string; model?: string; timeoutMs?: number } = {},
): Promise<CallResult> {
  // Claude Code has no CLI flag for skills — they're invoked as /skill-name inside the prompt itself.
  const fullPrompt = opts.skill ? `/${opts.skill} ${prompt}` : prompt
  const args = [
    '-p',
    fullPrompt,
    '--output-format',
    'json',
    '--model',
    opts.model || DEFAULT_CLAUDE_MODEL,
    // Non-interactive: nothing can answer a permission prompt, so this session must be trusted
    // up front. Reachable only from the read-write dev server — the read-only viewer already
    // blocks every non-GET /api/* route, including this one.
    '--permission-mode',
    'bypassPermissions',
  ]
  if (opts.resume) args.push('--resume', opts.resume)

  const { stdout } = await exec(CLAUDE_BIN, args, {
    cwd: DOCS_CWD,
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 20 * 1024 * 1024,
  })

  let parsed: ClaudePrintResult
  try {
    parsed = JSON.parse(stdout) as ClaudePrintResult
  } catch {
    throw new Error(`Claude Code 응답을 파싱할 수 없습니다: ${stdout.slice(0, 500)}`)
  }
  if (parsed.is_error || parsed.subtype !== 'success') {
    throw new Error(parsed.result || `Claude Code 오류 (${parsed.subtype})`)
  }

  recordClaudeSession(parsed.session_id, prompt)
  return { text: parsed.result || '(no response)', sessionId: parsed.session_id }
}

export async function agentChat(
  prompt: string,
  opts: { sessionId?: string; skill?: string; model?: string; provider?: AgentProvider } = {},
): Promise<CallResult> {
  const call = opts.provider === 'claude' ? callClaude : callHermes
  return call(prompt, {
    resume: opts.sessionId,
    skill: opts.skill,
    model: opts.model,
    timeoutMs: 120_000,
  })
}

function openStateDb(): DatabaseSync {
  return new DatabaseSync(STATE_DB, { readOnly: true })
}

function listHermesSessions(limit: number): AgentSession[] {
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

function getHermesSessionMessages(sessionId: string): AgentMessage[] {
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

interface ClaudeSessionRecord {
  id: string
  title: string
  startedAt: number
  lastActiveAt: number
  messageCount: number
}

function readClaudeRegistry(): ClaudeSessionRecord[] {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SESSIONS_REGISTRY, 'utf-8')) as ClaudeSessionRecord[]
  } catch {
    return []
  }
}

function recordClaudeSession(sessionId: string, firstPrompt: string) {
  const records = readClaudeRegistry()
  const now = Math.floor(Date.now() / 1000)
  const existing = records.find((r) => r.id === sessionId)
  if (existing) {
    existing.lastActiveAt = now
    existing.messageCount += 1
  } else {
    records.unshift({ id: sessionId, title: firstPrompt.slice(0, 60), startedAt: now, lastActiveAt: now, messageCount: 1 })
  }
  fs.mkdirSync(path.dirname(CLAUDE_SESSIONS_REGISTRY), { recursive: true })
  fs.writeFileSync(CLAUDE_SESSIONS_REGISTRY, JSON.stringify(records.slice(0, 100), null, 2), 'utf-8')
}

function listClaudeSessions(limit: number): AgentSession[] {
  return readClaudeRegistry()
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, limit)
    .map((r) => ({ id: r.id, title: r.title, startedAt: r.startedAt, lastActiveAt: r.lastActiveAt, messageCount: r.messageCount }))
}

function getClaudeSessionMessages(sessionId: string): AgentMessage[] {
  const transcriptPath = path.join(CLAUDE_PROJECT_DIR, `${sessionId}.jsonl`)
  if (!fs.existsSync(transcriptPath)) return []
  const messages: AgentMessage[] = []
  for (const line of fs.readFileSync(transcriptPath, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    let entry: { type?: string; message?: { content?: unknown } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue
    const content = entry.message?.content
    const text = Array.isArray(content)
      ? content
          .filter((b): b is { type: string; text: string } => typeof b === 'object' && b !== null && b.type === 'text')
          .map((b) => b.text)
          .join('\n')
      : typeof content === 'string'
        ? content
        : ''
    if (text.trim()) messages.push({ role: entry.type, content: text })
  }
  return messages
}

export function listAgentSessions(provider: AgentProvider = 'hermes', limit = 30): AgentSession[] {
  return provider === 'claude' ? listClaudeSessions(limit) : listHermesSessions(limit)
}

export function getAgentSessionMessages(provider: AgentProvider, sessionId: string): AgentMessage[] {
  return provider === 'claude' ? getClaudeSessionMessages(sessionId) : getHermesSessionMessages(sessionId)
}

function listHermesModels(): { default: string; models: string[] } {
  // headroom은 OpenRouter 프록시이므로 hermes의 openrouter 모델 캐시를 그대로 쓴다
  let models: string[] = []
  try {
    const cache = JSON.parse(fs.readFileSync(MODELS_CACHE, 'utf-8')) as Record<string, { models?: string[] }>
    models = cache.openrouter?.models ?? []
  } catch {
    // 캐시가 없으면 기본 모델만 노출
  }
  if (!models.includes(DEFAULT_HERMES_MODEL)) models = [DEFAULT_HERMES_MODEL, ...models]
  return { default: DEFAULT_HERMES_MODEL, models }
}

export function listAgentModels(provider: AgentProvider = 'hermes'): { default: string; models: string[] } {
  if (provider === 'claude') return { default: DEFAULT_CLAUDE_MODEL, models: CLAUDE_MODELS }
  return listHermesModels()
}

// a skill is any directory holding a SKILL.md, either at the top level or one category level down
function scanSkillsDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const names = new Set<string>()
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sub = path.join(dir, entry.name)
    if (fs.existsSync(path.join(sub, 'SKILL.md'))) {
      names.add(entry.name)
      continue
    }
    for (const inner of fs.readdirSync(sub, { withFileTypes: true })) {
      if (inner.isDirectory() && fs.existsSync(path.join(sub, inner.name, 'SKILL.md'))) names.add(inner.name)
    }
  }
  return [...names].sort()
}

export function listAgentSkills(provider: AgentProvider = 'hermes'): string[] {
  return scanSkillsDir(provider === 'claude' ? CLAUDE_SKILLS_DIR : HERMES_SKILLS_DIR)
}
