export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

export interface CommitResult {
  message: string
  files: string[]
  hash: string | null
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function fetchMode(): Promise<{ readOnly: boolean }> {
  return fetch('/api/mode').then(json<{ readOnly: boolean }>)
}

export function fetchTree(): Promise<TreeNode[]> {
  return fetch('/api/tree').then(json<TreeNode[]>)
}

export function fetchFile(path: string): Promise<{ path: string; content: string }> {
  return fetch(`/api/file?path=${encodeURIComponent(path)}`).then(json<{ path: string; content: string }>)
}

export function saveFile(path: string, content: string, commit = false): Promise<{ ok: true; commit: CommitResult | null }> {
  return fetch('/api/file', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, commit }),
  }).then(json<{ ok: true; commit: CommitResult | null }>)
}

export interface DocRules {
  archived: boolean
  mocApplicable: boolean
  mocRegistered: boolean
  brokenLinks: string[]
}

export function fetchRules(path: string): Promise<DocRules> {
  return fetch(`/api/rules?path=${encodeURIComponent(path)}`).then(json<DocRules>)
}

export function fetchNextAdrNumber(): Promise<{ number: string }> {
  return fetch('/api/adr-next').then(json<{ number: string }>)
}

export function createNewDocument(relPath: string, title: string): Promise<{ ok: true; relPath: string; commit: CommitResult | null }> {
  return fetch('/api/new-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath, title }),
  }).then(json<{ ok: true; relPath: string; commit: CommitResult | null }>)
}

export function createNewAdr(
  scope: string,
  title: string,
): Promise<{ ok: true; relPath: string; number: string; commit: CommitResult | null }> {
  return fetch('/api/new-adr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, title }),
  }).then(json<{ ok: true; relPath: string; number: string; commit: CommitResult | null }>)
}

export function uploadAsset(file: File): Promise<{ url: string; name: string; mimetype: string }> {
  const body = new FormData()
  body.append('file', file)
  return fetch('/api/upload', { method: 'POST', body }).then(json<{ url: string; name: string; mimetype: string }>)
}

export function saveToInbox(title: string, content: string): Promise<{ ok: boolean; path: string }> {
  return fetch('/api/inbox-new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  }).then(json<{ ok: boolean; path: string }>)
}

export function triggerAgentFileInbox(): Promise<{ ok: boolean; result: string }> {
  return fetch('/api/inbox-file', { method: 'POST' }).then(json<{ ok: boolean; result: string }>)
}

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

export function chatWithAgent(
  message: string,
  opts: { sessionId?: string; skill?: string; model?: string } = {},
): Promise<{ ok: boolean; response: string; sessionId: string | null }> {
  return fetch('/api/agent-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId: opts.sessionId, skill: opts.skill, model: opts.model }),
  }).then(json<{ ok: boolean; response: string; sessionId: string | null }>)
}

export function fetchAgentSessions(): Promise<AgentSession[]> {
  return fetch('/api/agent-sessions').then(json<AgentSession[]>)
}

export function fetchAgentMessages(sessionId: string): Promise<AgentMessage[]> {
  return fetch(`/api/agent-messages?id=${encodeURIComponent(sessionId)}`).then(json<AgentMessage[]>)
}

export function fetchAgentSkills(): Promise<string[]> {
  return fetch('/api/agent-skills').then(json<string[]>)
}

export interface AgentModels {
  default: string
  models: string[]
}

export function fetchAgentModels(): Promise<AgentModels> {
  return fetch('/api/agent-models').then(json<AgentModels>)
}
