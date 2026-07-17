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

export function fetchMode(): Promise<{ readOnly: boolean; docsRoot: string | null }> {
  return fetch('/api/mode').then(json<{ readOnly: boolean; docsRoot: string | null }>)
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

export function deleteFile(path: string): Promise<{ ok: true; commit: CommitResult | null }> {
  return fetch(`/api/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' }).then(
    json<{ ok: true; commit: CommitResult | null }>,
  )
}

export function renamePath(oldPath: string, newPath: string): Promise<{ ok: true; relPath: string; commit: CommitResult | null }> {
  return fetch('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newPath }),
  }).then(json<{ ok: true; relPath: string; commit: CommitResult | null }>)
}

export function createFolder(relPath: string): Promise<{ ok: true; relPath: string }> {
  return fetch('/api/new-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath }),
  }).then(json<{ ok: true; relPath: string }>)
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

export function createNewDocument(relPath: string, title: string): Promise<{ ok: true; relPath: string; commit: CommitResult | null }> {
  return fetch('/api/new-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relPath, title }),
  }).then(json<{ ok: true; relPath: string; commit: CommitResult | null }>)
}

export function uploadAsset(file: File): Promise<{ url: string; name: string; mimetype: string }> {
  const body = new FormData()
  body.append('file', file)
  return fetch('/api/upload', { method: 'POST', body }).then(json<{ url: string; name: string; mimetype: string }>)
}

export type AgentProvider = 'hermes' | 'claude'

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
  opts: { sessionId?: string; skill?: string; model?: string; provider?: AgentProvider } = {},
): Promise<{ ok: boolean; response: string; sessionId: string | null }> {
  return fetch('/api/agent-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId: opts.sessionId, skill: opts.skill, model: opts.model, provider: opts.provider }),
  }).then(json<{ ok: boolean; response: string; sessionId: string | null }>)
}

export function fetchAgentSessions(provider: AgentProvider): Promise<AgentSession[]> {
  return fetch(`/api/agent-sessions?provider=${provider}`).then(json<AgentSession[]>)
}

export function fetchAgentMessages(provider: AgentProvider, sessionId: string): Promise<AgentMessage[]> {
  return fetch(`/api/agent-messages?provider=${provider}&id=${encodeURIComponent(sessionId)}`).then(json<AgentMessage[]>)
}

export function fetchAgentSkills(provider: AgentProvider): Promise<string[]> {
  return fetch(`/api/agent-skills?provider=${provider}`).then(json<string[]>)
}

export interface AgentModels {
  default: string
  models: string[]
}

export function fetchAgentModels(provider: AgentProvider): Promise<AgentModels> {
  return fetch(`/api/agent-models?provider=${provider}`).then(json<AgentModels>)
}

export interface TmuxSession {
  name: string
  createdAt: number
  attached: boolean
  windows: number
}

export function fetchTmuxSessions(): Promise<TmuxSession[]> {
  return fetch('/api/tmux/sessions').then(json<TmuxSession[]>)
}

export function createTmuxSession(name: string): Promise<{ ok: true; name: string }> {
  return fetch('/api/tmux/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(json<{ ok: true; name: string }>)
}

export function killTmuxSession(name: string): Promise<{ ok: true }> {
  return fetch(`/api/tmux/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' }).then(json<{ ok: true }>)
}

export function renameTmuxSession(name: string, newName: string): Promise<{ ok: true; name: string }> {
  return fetch(`/api/tmux/sessions/${encodeURIComponent(name)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName }),
  }).then(json<{ ok: true; name: string }>)
}
