import type { IncomingMessage } from 'node:http'
import { canUse, unrestrictedFiles, unrestrictedWorkspaceFiles } from './access-policy.ts'
import { runAccountWorkspace } from './account-workspace.ts'
import { resolveAuth, type RequestAuth } from './reqAuth.ts'
import { pathsForWorkspace, workspaceContext, workspacePaths, WORKSPACE_PROJECT } from './paths.ts'
import { requestIp } from './change-ip.ts'
import { repositoryInfo, repositoryLog, workingTreeDetail, workingTreeFileDiff } from './gitWorkbench.ts'
import { readFeatureSnapshot } from './feature-routes.ts'
import { readDebuggerStatus, readDebuggerBrowserStatus } from './debugger-routes.ts'
import type { LiveResource } from '../shared/live-updates.ts'
import type { LiveSource } from './live-socket.ts'

function text(value: unknown, empty = false): value is string { return typeof value === 'string' && value.length <= 4096 && (empty || !!value) && !value.includes('\0') }
function valid(resource: LiveResource) {
  if (!resource || typeof resource !== 'object') return false
  if (['features', 'debugger', 'debugger-browser'].includes(resource.kind)) return 'workspace' in resource && text(resource.workspace)
  if (resource.kind === 'git' || resource.kind === 'git-diff') return text(resource.project) && text(resource.path, true) && (resource.kind !== 'git-diff' || text(resource.file))
  return false
}
function permitted(auth: RequestAuth, resource: LiveResource): boolean {
  if (!auth.email || auth.mustChangePassword) return false
  if (resource.kind === 'features') return resource.workspace === workspacePaths.root && canUse(auth, 'agent') && unrestrictedWorkspaceFiles(auth, workspacePaths.root)
  if (resource.kind === 'git' || resource.kind === 'git-diff') return canUse(auth, 'git') && unrestrictedFiles(auth, resource.project)
  return resource.workspace === workspacePaths.root && ['owner', 'manager'].includes(auth.role) && canUse(auth, 'terminal') && unrestrictedFiles(auth, WORKSPACE_PROJECT, true)
}

export function createLiveSource(req: IncomingMessage, resource: LiveResource, getAuth = resolveAuth): LiveSource {
  if (!valid(resource)) throw new Error('지원하지 않는 구독입니다.')
  const auth = getAuth(req)
  return runAccountWorkspace(auth.email, () => {
    if (!permitted(auth, resource)) throw new Error('구독 권한 또는 프로젝트를 확인하세요.')
    const scope = pathsForWorkspace(workspacePaths.root, auth.email)
    const canEdit = resource.kind === 'features' && unrestrictedWorkspaceFiles(auth, scope.root, true)
    const ip = requestIp(req)
    const allowed = () => {
      const current = getAuth(req)
      return current.email === auth.email && runAccountWorkspace(current.email, () => workspacePaths.root === scope.root && workspacePaths.docsRoot === scope.docsRoot && permitted(current, resource) && (resource.kind !== 'features' || unrestrictedWorkspaceFiles(current, scope.root, true) === canEdit))
    }
    return {
      // Account scopes keep debugger state and authorization isolated. Git IP attribution is per viewer.
      key: JSON.stringify([auth.email, scope.root, scope.docsRoot, resource, canEdit, resource.kind === 'git' ? ip : null]),
      interval: resource.kind === 'debugger' ? 1000 : 2000,
      allowed,
      read: () => workspaceContext.run(scope, async () => {
        if (resource.kind === 'features') return readFeatureSnapshot(getAuth(req))
        if (resource.kind === 'debugger') return readDebuggerStatus(auth.email!)
        if (resource.kind === 'debugger-browser') return readDebuggerBrowserStatus(auth.email!)
        if (resource.kind === 'git') {
          const info = await repositoryInfo(resource.project, resource.path)
          if (!info.repository) return { info, commits: [], workingTree: { files: [] } }
          const [commits, workingTree] = await Promise.all([repositoryLog(resource.project, resource.path), workingTreeDetail(resource.project, resource.path, ip)])
          return { info, commits, workingTree }
        }
        const working = await workingTreeDetail(resource.project, resource.path)
        const file = working.files.find(item => item.path === resource.file)
        return { diff: file ? await workingTreeFileDiff(resource.project, resource.path, resource.file) : '', deleted: file?.status.includes('D') ?? false }
      }),
    }
  })
}
