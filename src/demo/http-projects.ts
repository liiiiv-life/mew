import type { ProjectInfo } from '../api/client.ts'
import { demoJson, requireMethod, stringField, type DemoHttpHandler } from './http.ts'
import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'

const join = (parent: string, name: string) => `${parent.replace(/\/$/, '')}/${name}`
const basename = (path: string) => path.split('/').at(-1) ?? ''
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/'))

function folderName(name: string): string {
  const value = name.trim()
  if (!value || value === '.' || value === '..' || /[\\/\p{Cc}]/u.test(value)) throw new DemoError('폴더 이름을 확인해 주세요.')
  return value
}

function absolutePath(store: DemoWorkspaceStore, path: string, project = '.workspace'): string {
  const relative = store.canonicalFilePath(path, project)
  return join(store.workspacePath, relative).replace(/\/$/, '')
}

export const handleDemoProjects: DemoHttpHandler = ({ store, request, url, body, project }) => {
  const route = url.pathname, method = request.method
  const root = store.workspaceInfo().path
  if (route === '/api/workspace' || route === '/api/fs/open-project' || route === '/api/subprojects/open') {
    requireMethod(request, ...(route === '/api/workspace' ? ['GET', 'POST'] : ['POST']))
    if (method === 'GET') return demoJson(store.workspaceInfo())
    const target = stringField(body, 'path')
    const absolute = absolutePath(store, target, route === '/api/subprojects/open' ? project : '.workspace')
    if (!store.tree('.workspace', absolute).length) store.seedProject(absolute)
    const info = store.openWorkspace(absolute)
    return demoJson(route === '/api/fs/open-project' ? { ...info, project: '.workspace' } : info)
  }
  if (route === '/api/projects') {
    requireMethod(request, 'GET')
    const icons = store.getState<Record<string, string>>('project-icons', {}), layout = store.getState<Record<string, number>>(`project-layout:${root}`, {})
    return demoJson(store.projectNames().map(name => ({ name, icon: icons[join(root, name)] ?? icons[name] ?? null, slot: layout[name] ?? null } satisfies ProjectInfo)))
  }
  if (route === '/api/project') {
    requireMethod(request, 'POST', 'PUT', 'DELETE')
    const name = folderName(method === 'DELETE' ? url.searchParams.get('name') ?? '' : stringField(body, method === 'PUT' ? 'oldName' : 'name'))
    if (name.startsWith('.') || name === 'docs' || name === 'node_modules') throw new DemoError('다른 프로젝트 이름을 입력하세요.')
    const target = join(root, name)
    if (method === 'POST') {
      store.createDirectory(target)
      store.seedProject(target)
    } else if (method === 'PUT') {
      const next = folderName(stringField(body, 'newName'))
      if (next.startsWith('.') || next === 'docs' || next === 'node_modules') throw new DemoError('다른 프로젝트 이름을 입력하세요.')
      store.movePath(target, join(root, next))
      store.setState('project-roots', store.getState<string[]>('project-roots', []).map(path => path === target || path.startsWith(`${target}/`) ? join(root, next) + path.slice(target.length) : path))
      return demoJson({ ok: true, name: next })
    } else {
      store.deletePath(target)
      store.setState('project-roots', store.getState<string[]>('project-roots', []).filter(path => path !== target && !path.startsWith(`${target}/`)))
    }
    return demoJson(method === 'DELETE' ? { ok: true } : { ok: true, name })
  }
  if (route === '/api/project-layout') {
    requireMethod(request, 'PUT')
    if (!body.layout || typeof body.layout !== 'object' || Array.isArray(body.layout)) throw new DemoError('배치 정보를 확인해 주세요.')
    for (const value of Object.values(body.layout)) if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 999) throw new DemoError('배치 정보를 확인해 주세요.')
    store.setState(`project-layout:${root}`, body.layout)
    return demoJson({ ok: true })
  }
  if (route === '/api/subprojects') {
    requireMethod(request, 'POST')
    const target = absolutePath(store, stringField(body, 'path'), project)
    store.registerProject(target)
    return demoJson({ ok: true })
  }
  if (route === '/api/fs/git/clone') {
    requireMethod(request, 'POST')
    const repositoryUrl = stringField(body, 'url').trim()
    if (!repositoryUrl) throw new DemoError('저장소 주소를 입력하세요.')
    const name = folderName(stringField(body, 'name') || basename(repositoryUrl.replace(/\/+$/, '')).replace(/\.git$/i, ''))
    const target = join(absolutePath(store, stringField(body, 'parent')), name)
    store.createDirectory(target)
    store.seedProject(target)
    store.setState(`git-origin:${target}`, repositoryUrl)
    store.setState('git-roots', [...new Set([...store.getState<string[]>('git-roots', [store.workspacePath]), target])])
    return demoJson({ ok: true, path: target })
  }
  if (route === '/api/fs/git/init') {
    requireMethod(request, 'POST')
    const target = absolutePath(store, stringField(body, 'path'))
    store.tree('.workspace', target)
    store.setState('git-roots', [...new Set([...store.getState<string[]>('git-roots', [store.workspacePath]), target])])
    return demoJson({ ok: true, path: target })
  }
  if (route === '/api/fs/entries') {
    requireMethod(request, 'GET')
    const target = absolutePath(store, url.searchParams.get('path') || root)
    let nodes
    try { nodes = store.tree('.workspace', target) } catch (error) {
      if (!(error instanceof DemoError) || error.status !== 404) throw error
      let existing = target
      while (existing !== store.workspacePath) {
        existing = parentOf(existing)
        try { store.tree('.workspace', existing); break } catch (parentError) { if (!(parentError instanceof DemoError) || parentError.status !== 404) throw parentError }
      }
      return demoJson({ error: '폴더를 찾을 수 없습니다.', code: 'MISSING_DIRECTORY', missing: { path: target, existingPath: existing, missingName: target.slice(existing.length + 1) } }, 404)
    }
    const repositories = store.getState<string[]>('git-roots', [store.workspacePath])
    const entries = nodes.map(node => ({ name: node.name, path: join(target, node.name), type: node.type, size: node.type === 'file' ? store.fileInfo(join(target, node.name)).size : null, ...(repositories.includes(join(target, node.name)) ? { git: true } : {}) }))
    if (repositories.includes(target)) entries.unshift({ name: '.git', path: join(target, '.git'), type: 'dir', size: null })
    return demoJson({ path: target, canonicalPath: target, parent: target === store.workspacePath ? null : parentOf(target), entries })
  }
}
