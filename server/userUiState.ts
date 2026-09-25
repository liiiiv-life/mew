import { normalizeProjectTabLayout, type ProjectTabGroup } from '../shared/project-tab-groups.ts'
import path from 'node:path'
import { DATA_DIR, readJsonRecord, writeFileAtomic } from './dataDir.ts'
import { normalizeEmail } from './auth.ts'
import { normalizeIconValue } from './svgIcon.ts'
import type { FileFavoritePreferences } from '../shared/file-favorites.ts'

// 로그인 계정이 어느 브라우저에서든 이어야 할 "작업 맥락"만 저장한다. 화면 크기·초안처럼
// 기기 성격인 값까지 넣지 않는다(ADR 0093).
const STATE_FILE = path.join(DATA_DIR, 'user-ui-state.json')
const MAX_PROJECTS = 100
const MAX_TABS = 100
const MAX_PATH = 4_096
const TAB_ID = /^[A-Za-z0-9_-]{1,64}$/

export type StoredAgentTab = {
  id: string
  label: string
  runtime?: string | null
  cwd?: string | null
  renamed?: boolean
  sessionIds?: Record<string, string>
  preset?: { id: string; name: string; modelId: string; role: string }
}

export type StoredAgentTabs = { tabs: StoredAgentTab[]; activeId: string | null }
export type StoredRootProjects = { paths: string[]; icons: Record<string, string>; groups?: ProjectTabGroup[] }
/** 계정에 귀속하는 작업 화면 상태. 브라우저별 폭·글꼴·작성 중 초안은 넣지 않는다. */
export type StoredWorkspaceUi = Record<string, unknown>

type UserUiState = {
  fileFavorites?: FileFavoritePreferences
  rootProjects?: StoredRootProjects
  agentTabs?: Record<string, StoredAgentTabs>
  workspaceUi?: Record<string, StoredWorkspaceUi>
}

export function readFileFavorites(email: string): FileFavoritePreferences {
  return userState(readAll(), email).fileFavorites ?? { added: [], hidden: [] }
}

/** Apply one path at a time so saves from different browser windows preserve other favorites. */
export function updateFileFavorite(email: string, folder: string, favorite: boolean): FileFavoritePreferences {
  if (!validPath(folder)) throw new Error('즐겨찾기 경로가 올바르지 않습니다')
  const all = readAll()
  const previous = userState(all, email)
  const saved = previous.fileFavorites ?? { added: [], hidden: [] }
  const added = new Set(saved.added)
  const hidden = new Set(saved.hidden)
  if (favorite) { added.add(folder); hidden.delete(folder) }
  else { added.delete(folder); hidden.add(folder) }
  if (added.size > 200 || hidden.size > 200) throw new Error('즐겨찾기는 최대 200개입니다')
  const value = { added: [...added], hidden: [...hidden] }
  all[normalizeEmail(email)] = { ...previous, fileFavorites: value }
  writeAll(all)
  return value
}

function readAll(): Record<string, UserUiState> {
  return readJsonRecord<UserUiState>(STATE_FILE) ?? {}
}

function writeAll(state: Record<string, UserUiState>) {
  writeFileAtomic(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
}

function userState(all: Record<string, UserUiState>, email: string): UserUiState {
  return all[normalizeEmail(email)] ?? {}
}

function validPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && path.isAbsolute(value)
}

function optionalText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined
}

export function normalizeRootProjects(input: unknown): StoredRootProjects {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('프로젝트 탭 상태 형식이 올바르지 않습니다')
  const record = input as { paths?: unknown; icons?: unknown; groups?: unknown }
  if (!Array.isArray(record.paths)) throw new Error('프로젝트 탭 경로가 필요합니다')
  const paths = [...new Set(record.paths.filter(validPath))]
  if (paths.length > MAX_PROJECTS) throw new Error(`프로젝트 탭은 최대 ${MAX_PROJECTS}개입니다`)
  if (!record.icons || typeof record.icons !== 'object' || Array.isArray(record.icons)) throw new Error('프로젝트 아이콘 형식이 올바르지 않습니다')
  const icons: Record<string, string> = {}
  for (const [projectPath, icon] of Object.entries(record.icons)) {
    if (!validPath(projectPath) || !paths.includes(projectPath) || typeof icon !== 'string') continue
    const normalized = normalizeIconValue(icon)
    if (normalized) icons[projectPath] = normalized
  }
  const layout = normalizeProjectTabLayout(paths, record.groups)
  return { paths: layout.paths, icons, ...(record.groups !== undefined ? { groups: layout.groups } : {}) }
}

export function normalizeAgentTabs(input: unknown): StoredAgentTabs {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('에이전트 탭 상태 형식이 올바르지 않습니다')
  const record = input as { tabs?: unknown; activeId?: unknown }
  if (!Array.isArray(record.tabs) || record.tabs.length > MAX_TABS) throw new Error(`에이전트 탭은 최대 ${MAX_TABS}개입니다`)
  const ids = new Set<string>()
  const tabs: StoredAgentTab[] = []
  for (const raw of record.tabs) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const tab = raw as Record<string, unknown>
    if (typeof tab.id !== 'string' || !TAB_ID.test(tab.id) || ids.has(tab.id)) continue
    const label = optionalText(tab.label, 200)
    if (!label) continue
    ids.add(tab.id)
    const sessionIds: Record<string, string> = {}
    if (tab.sessionIds && typeof tab.sessionIds === 'object' && !Array.isArray(tab.sessionIds)) {
      for (const [slot, sessionId] of Object.entries(tab.sessionIds)) {
        if (slot.length <= 512 && typeof sessionId === 'string' && sessionId.length <= 256) sessionIds[slot] = sessionId
      }
    }
    tabs.push({
      id: tab.id,
      label,
      ...(tab.runtime === null || optionalText(tab.runtime, 100) ? { runtime: tab.runtime === null ? null : tab.runtime as string } : {}),
      ...(tab.cwd === null || validPath(tab.cwd) ? { cwd: tab.cwd as string | null } : {}),
      ...(tab.renamed === true ? { renamed: true } : {}),
      ...(Object.keys(sessionIds).length > 0 ? { sessionIds } : {}),
      ...(tab.preset && typeof tab.preset === 'object' && !Array.isArray(tab.preset)
        && optionalText((tab.preset as Record<string, unknown>).id, 100)
        && optionalText((tab.preset as Record<string, unknown>).name, 200)
        && optionalText((tab.preset as Record<string, unknown>).modelId, 120) !== undefined
        && optionalText((tab.preset as Record<string, unknown>).role, 4_000)
        ? { preset: {
            id: (tab.preset as Record<string, unknown>).id as string,
            name: (tab.preset as Record<string, unknown>).name as string,
            modelId: (tab.preset as Record<string, unknown>).modelId as string,
            role: (tab.preset as Record<string, unknown>).role as string,
          } }
        : {}),
    })
  }
  const activeId = typeof record.activeId === 'string' && ids.has(record.activeId) ? record.activeId : null
  return { tabs, activeId }
}

export function readRootProjects(email: string): StoredRootProjects | null {
  return userState(readAll(), email).rootProjects ?? null
}

export function writeRootProjects(email: string, input: unknown): StoredRootProjects {
  const value = normalizeRootProjects(input)
  const all = readAll()
  const key = normalizeEmail(email)
  all[key] = { ...userState(all, key), rootProjects: value }
  writeAll(all)
  return value
}

export function readAgentTabs(email: string, workspacePath: string): StoredAgentTabs | null {
  return userState(readAll(), email).agentTabs?.[workspacePath] ?? null
}

/** 같은 계정의 다른 루트 화면에 숨은 탭도 동일 ACP thread의 소유자다. */
export function readAgentSessionClaims(email: string): Array<{ workspacePath: string; tabId: string; sessionId: string }> {
  const claims: Array<{ workspacePath: string; tabId: string; sessionId: string }> = []
  const workspaces = userState(readAll(), email).agentTabs ?? {}
  for (const [workspacePath, state] of Object.entries(workspaces)) {
    for (const tab of state.tabs) {
      for (const sessionId of Object.values(tab.sessionIds ?? {})) {
        claims.push({ workspacePath, tabId: tab.id, sessionId })
      }
    }
  }
  return claims
}

export function writeAgentTabs(email: string, workspacePath: string, input: unknown): StoredAgentTabs {
  if (!validPath(workspacePath)) throw new Error('작업 폴더 경로가 올바르지 않습니다')
  const value = normalizeAgentTabs(input)
  const all = readAll()
  const key = normalizeEmail(email)
  const previous = userState(all, key)
  all[key] = { ...previous, agentTabs: { ...previous.agentTabs, [workspacePath]: value } }
  writeAll(all)
  return value
}

function normalizeWorkspaceUi(input: unknown): StoredWorkspaceUi {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('작업 화면 상태 형식이 올바르지 않습니다')
  const serialized = JSON.stringify(input)
  if (serialized.length > 512 * 1024) throw new Error('작업 화면 상태가 너무 큽니다')
  return JSON.parse(serialized) as StoredWorkspaceUi
}

export function readWorkspaceUi(email: string, workspacePath: string): StoredWorkspaceUi | null {
  if (!validPath(workspacePath)) throw new Error('작업 폴더 경로가 올바르지 않습니다')
  return userState(readAll(), email).workspaceUi?.[workspacePath] ?? null
}

export function writeWorkspaceUi(email: string, workspacePath: string, input: unknown): StoredWorkspaceUi {
  if (!validPath(workspacePath)) throw new Error('작업 폴더 경로가 올바르지 않습니다')
  const value = normalizeWorkspaceUi(input)
  const all = readAll()
  const key = normalizeEmail(email)
  const previous = userState(all, key)
  all[key] = { ...previous, workspaceUi: { ...previous.workspaceUi, [workspacePath]: value } }
  writeAll(all)
  return value
}
