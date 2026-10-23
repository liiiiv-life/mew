import { parseDocument } from 'yaml'
import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'

export function demoDocument(raw: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  const yaml = parseDocument(match?.[1] ?? '')
  if (yaml.errors.length) throw new DemoError('문서 속성의 YAML 형식을 확인해 주세요.')
  const fields: unknown = yaml.toJS({ maxAliasCount: 20 })
  if (fields != null && (typeof fields !== 'object' || Array.isArray(fields))) throw new DemoError('문서 속성은 객체여야 합니다.')
  return { yaml, fields: (fields ?? {}) as Record<string, unknown>, body: match ? raw.slice(match[0].length) : raw }
}

export function demoFilename(title: string): string {
  let name = title.replace(/[<>:"/\\|?*\p{Cc}]/gu, '-').trim().replace(/[. ]+$/, '') || '제목 없음'
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`
  let result = ''
  for (const character of name) { if (new TextEncoder().encode(result + character).length > 200) break; result += character }
  return result.replace(/[. ]+$/, '') || '제목 없음'
}

export function demoDocumentHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0 || 1
}

export function demoWorkspaceFiles(store: DemoWorkspaceStore, workspace = store.workspaceInfo().path) {
  const root = store.canonicalFilePath(workspace), prefix = root ? `${root}/` : ''
  return store.repositoryEntries().filter(file => file.path.startsWith(prefix)).map(file => ({ path: file.path.slice(prefix.length), get content() { return file.content } }))
}

export async function loadDemoWorkspaceDocuments(store: DemoWorkspaceStore, workspace: string, predicate: (path: string) => boolean, signal?: AbortSignal): Promise<void> {
  requireDemoWorkspace(store, workspace)
  await store.loadFiles('.workspace', predicate, signal)
  requireDemoWorkspace(store, workspace)
}

export function requireDemoWorkspace(store: DemoWorkspaceStore, workspace: unknown): string {
  const active = store.workspaceInfo().path
  if (workspace !== undefined && workspace !== null && workspace !== active) throw new DemoError('프로젝트가 변경되었습니다. 현재 프로젝트에서 다시 열어 주세요.', 409)
  return active
}
