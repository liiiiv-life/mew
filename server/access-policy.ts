import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { DATA_DIR, writeFileAtomic } from './dataDir.ts'
import { WORKSPACE_ROOT, resolveProjectPath, isDeniedSegment, isSecretFile } from './paths.ts'
import { defaultCapabilities, FEATURES, GUEST_FEATURES, type Capabilities, type Feature, type FileRule } from '../shared/access-policy.ts'
import type { RequestAuth } from './reqAuth.ts'
import type { TreeNode } from './tree.ts'

const FILE = path.join(DATA_DIR, 'access-policy.json')
interface Policy { version: 1; features: Record<string, Partial<Capabilities>>; workspaces: Record<string, Record<string, FileRule[]>> }
export const accessChanges = new EventEmitter()
accessChanges.setMaxListeners(0)
let legacyPolicy: Policy | null = null
let cache: Policy | null = null
let stamp = ''

function canonical(file: string): string {
  try { return fs.realpathSync(file) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(file)
    if (parent === file) throw error
    return path.join(canonical(parent), path.basename(file))
  }
}
export function workspaceScope(): string { return canonical(WORKSPACE_ROOT) }
export function accessRevision(): string {
  try { const stat = fs.statSync(FILE); return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}` } catch { return 'legacy' }
}
function load(): Policy {
  try {
    const stat = fs.statSync(FILE), nextStamp = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`
    if (cache && stamp === nextStamp) return cache
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Policy
    if (value.version !== 1 || !value.features || !value.workspaces) throw new Error('Invalid access policy')
    cache = value; stamp = nextStamp
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Import once in the active workspace, then retain that scope across root switches.
    if (legacyPolicy) return legacyPolicy
    const value: Policy = { version: 1, features: {}, workspaces: {} }
    try {
      const legacy = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'guest-access.json'), 'utf8')) as { projects: Record<string, FileRule[]> }
      {
        const rules: FileRule[] = []
        for (const [project, entries] of Object.entries(legacy.projects)) for (const rule of entries) {
          try { rules.push({ ...rule, path: policyPath(project, rule.path) }) } catch { /* obsolete project */ }
        }
        value.workspaces[workspaceScope()] = { guest: rules }
      }
    } catch (legacyError) { if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') throw legacyError }
    legacyPolicy = value
    return value
  }
}
function save(data: Policy) {
  writeFileAtomic(FILE, JSON.stringify(data, null, 2) + '\n')
  cache = null
  accessChanges.emit('change')
}
export function subjectOf(auth: RequestAuth): string { return auth.role === 'guest' ? 'guest' : auth.email ?? 'guest' }
export function featureOverrides(subject: string): Partial<Capabilities> { return { ...load().features[subject] } }
export function capabilitiesFor(auth: RequestAuth): Capabilities {
  const values = { ...defaultCapabilities(auth.role), ...featureOverrides(subjectOf(auth)) }
  for (const feature of FEATURES) {
    if (auth.mustChangePassword || (auth.role === 'guest' && !GUEST_FEATURES.includes(feature))) values[feature] = false
  }
  return values
}
export function canUse(auth: RequestAuth, feature: Feature): boolean { try { return capabilitiesFor(auth)[feature] } catch { return false } }
export function setFeature(subject: string, feature: Feature, enabled: boolean | null) {
  if (!FEATURES.includes(feature) || (enabled !== null && typeof enabled !== 'boolean')) throw new Error('올바른 기능 권한을 선택하세요')
  if (subject === 'guest' && !GUEST_FEATURES.includes(feature)) throw new Error('이 기능은 로그인 계정만 사용할 수 있습니다')
  const data = structuredClone(load()), overrides = { ...data.features[subject] }
  if (enabled === null) delete overrides[feature]
  else overrides[feature] = enabled
  data.features[subject] = overrides
  save(data)
}

/** Canonical workspace-relative identity: aliases and symlinks cannot bypass a rule. */
export function policyPath(project: string, relPath: string): string {
  if (typeof relPath !== 'string' || relPath.includes('\0') || relPath.includes('\\')) throw new Error('올바른 경로를 입력하세요')
  const target = canonical(resolveProjectPath(project, relPath)), root = workspaceScope()
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || relative.split(path.sep).some(isDeniedSegment)) throw new Error('워크스페이스 밖 경로입니다')
  return relative.split(path.sep).join('/')
}
export function fileRules(subject: string): FileRule[] { return [...(load().workspaces[workspaceScope()]?.[subject] ?? [])] }
export function setFileRule(subject: string, project: string, relPath: string, access: 'inherit' | 'deny' | 'view' | 'edit') {
  if (!['inherit', 'deny', 'view', 'edit'].includes(access)) throw new Error('올바른 파일 권한을 선택하세요')
  const target = policyPath(project, relPath), data = structuredClone(load()), scope = workspaceScope()
  const subjects = { ...data.workspaces[scope] }, rules = (subjects[subject] ?? []).filter(rule => rule.path !== target)
  if (access !== 'inherit') rules.push({ path: target, view: access !== 'deny', edit: access === 'edit' })
  subjects[subject] = rules; data.workspaces[scope] = subjects
  save(data)
}
function matches(parent: string, target: string): boolean { return parent === '' || parent === target || target.startsWith(parent + '/') }
export function fileAccess(auth: RequestAuth, project: string, relPath: string): { view: boolean; edit: boolean } {
  try {
    const target = policyPath(project, relPath), caps = capabilitiesFor(auth)
    if (auth.role === 'guest' && target.split('/').some(isSecretFile)) return { view: false, edit: false }
    const rule = fileRules(subjectOf(auth)).filter(rule => matches(rule.path, target)).sort((a, b) => b.path.length - a.path.length)[0]
    const view = caps.filesRead && (rule?.view ?? auth.role !== 'guest')
    return { view, edit: view && caps.filesWrite && (rule?.edit ?? auth.role !== 'guest') }
  } catch { return { view: false, edit: false } }
}
/** Also checks descendant exceptions before a recursive operation / destination subtree. */
export function subtreeAccess(auth: RequestAuth, project: string, relPath: string, write = false, recursive = true): boolean {
  const permission = write ? 'edit' : 'view'
  if (!fileAccess(auth, project, relPath)[permission]) return false
  try {
    const target = policyPath(project, relPath)
    if (fileRules(subjectOf(auth)).some(rule => matches(target, rule.path) && !rule[permission])) return false
    // Never traverse a symlink tree to a different policy scope.
    const file = resolveProjectPath(project, relPath)
    if (recursive && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (fs.lstatSync(file).isSymbolicLink()) return false
      for (const entry of fs.readdirSync(file, { withFileTypes: true })) {
        if (isDeniedSegment(entry.name)) return false
        if (!subtreeAccess(auth, project, [relPath, entry.name].filter(Boolean).join('/'), write)) return false
      }
    }
    return true
  } catch { return false }
}
export function unrestrictedFiles(auth: RequestAuth, project: string, write = false): boolean {
  const key = write ? 'edit' : 'view'
  try {
    const target = policyPath(project, '')
    return auth.role !== 'guest' && fileAccess(auth, project, '')[key]
      && !fileRules(subjectOf(auth)).some(rule => matches(target, rule.path) && !rule[key])
  } catch { return false }
}
export function filterTreeForAccess(auth: RequestAuth, project: string, nodes: TreeNode[]): TreeNode[] {
  return nodes.flatMap(node => {
    const access = fileAccess(auth, project, node.path)
    const children = node.children ? filterTreeForAccess(auth, project, node.children) : undefined
    if (!access.view && !children?.length) return []
    return [{ ...node, ...(children ? { children } : {}), editable: access.edit }]
  })
}
export function relativeRulePath(project: string, rule: FileRule): string | null {
  const root = policyPath(project, '')
  return matches(root, rule.path) ? (root ? rule.path.slice(root.length).replace(/^\//, '') : rule.path) : null
}
