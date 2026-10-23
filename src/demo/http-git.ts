import { demoJson, requireMethod, stringArray, stringField, type DemoHttpHandler } from './http.ts'
import { DemoError } from './workspace-store.ts'

export const handleDemoGit: DemoHttpHandler = async ({ store, request, url, body, project }) => {
  const route = url.pathname, path = url.searchParams.get('path') ?? '', hash = url.searchParams.get('hash') ?? ''
  if (route === '/api/git/repository') { requireMethod(request, 'GET'); return demoJson(store.gitRepository()) }
  if (route === '/api/git/repositories') { requireMethod(request, 'GET'); return demoJson({ repositories: [{ path: store.workspacePath }] }) }
  if (route === '/api/git/log') { requireMethod(request, 'GET'); return demoJson({ commits: store.gitLog().commits.slice(0, Math.min(300, Number(url.searchParams.get('limit')) || 300)) }) }
  if (route === '/api/git/working-tree') { requireMethod(request, 'GET'); return demoJson(store.gitWorkingTree()) }
  if (route === '/api/git/working-tree/diff' || route === '/api/git/diff') {
    requireMethod(request, 'GET')
    const file = url.searchParams.get('file') ?? '', commit = route === '/api/git/diff' ? hash : undefined
    await store.loadDiff(file, commit, request.signal)
    return demoJson(store.gitDiff(file, commit))
  }
  if (route === '/api/git/commit') {
    requireMethod(request, 'GET', 'POST')
    if (request.method === 'GET') { const { snapshot: _snapshot, ...commit } = store.gitCommit(hash); return demoJson(commit) }
    const files = stringArray(body, 'files')
    return demoJson(store.commit(stringField(body, 'title'), stringField(body, 'description'), files.length ? files : undefined))
  }
  if (route === '/api/git/discard') { requireMethod(request, 'POST'); store.discard(stringArray(body, 'files')); return demoJson({ ok: true }) }
  if (route === '/api/git/branches') {
    requireMethod(request, 'GET', 'POST')
    return demoJson(request.method === 'GET' ? store.gitBranches() : store.setBranch(stringField(body, 'name') || stringField(body, 'ref').replace(/^refs\/heads\//, ''), body.action === 'create'))
  }
  if (route === '/api/git/action') {
    requireMethod(request, 'POST')
    if (body.action === 'branch') return demoJson(store.setBranch(stringField(body, 'name'), true))
    throw new DemoError('이 Git 작업은 데모에서 지원하지 않습니다.', 501)
  }
  if (route === '/api/git/init' || route === '/api/fs/git/init') { requireMethod(request, 'POST'); return demoJson(route === '/api/git/init' ? store.gitRepository() : { ok: true, path: store.workspacePath }) }
  if (route === '/api/file-history') {
    requireMethod(request, 'GET')
    const canonical = store.canonicalFilePath(path, project)
    return demoJson({ history: store.gitLog().commits.filter(commit => store.gitCommit(commit.hash).files.some(file => file.path === canonical)).map(commit => ({ hash: commit.hash, date: commit.date, message: commit.subject })) })
  }
  if (route === '/api/file-at-commit') { requireMethod(request, 'GET'); return demoJson({ content: await store.gitFileContent(path, hash, project, request.signal) ?? null }) }
  if (route === '/api/file-revert') {
    requireMethod(request, 'POST')
    const target = stringField(body, 'path'), root = store.projectRootPath(project), content = await store.gitFileContent(target, stringField(body, 'hash'), project, request.signal)
    if (store.projectRootPath(project) !== root) throw new DemoError('프로젝트가 변경되었습니다. 현재 프로젝트에서 다시 열어 주세요.', 409)
    if (content === undefined) throw new DemoError('이 커밋에는 파일이 없습니다.', 404)
    store.writeFile(target, content, project)
    return demoJson({ ok: true, content, commit: null })
  }
  if (route === '/api/git-connections/github') {
    requireMethod(request, 'GET', 'DELETE')
    return demoJson(request.method === 'DELETE' ? { ok: true } : { available: false, login: null, environmentToken: false, busy: false, job: null })
  }
  if (route === '/api/git/ai-commit') { requireMethod(request, 'GET'); return demoJson({ job: null }) }
}
