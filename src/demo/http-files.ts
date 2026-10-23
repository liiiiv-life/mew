import { parse as parseYaml } from 'yaml'
import { demoJson, requireMethod, stringArray, stringField, type DemoHttpHandler } from './http.ts'
import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'
import type { FileFavorite } from '../../shared/file-favorites.ts'
import { DemoDocumentPages } from './document-pages.ts'

const nameOf = (path: string) => path.split('/').at(-1) ?? ''
const directoryOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const join = (directory: string, name: string) => directory ? `${directory}/${name}` : name
const titleOf = (path: string, content: string) => content.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? content.match(/^#\s+(.+)$/m)?.[1] ?? nameOf(path).replace(/\.md$/, '')
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function requireProjectRoot(store: DemoWorkspaceStore, project: string, root: string): void {
  if (store.projectRootPath(project) !== root) throw new DemoError('프로젝트가 변경되었습니다. 현재 프로젝트에서 다시 열어 주세요.', 409)
}

function queryPattern(query: string, regex: boolean, caseSensitive: boolean, filename = false): RegExp {
  if (query.length > 300) throw new DemoError('데모 검색어는 300자 이하여야 합니다.')
  const source = regex ? query : /[*?]/.test(query) ? [...query].map(char => char === '*' ? '.*' : char === '?' ? '.' : escape(char)).join('') : filename ? [...query].map(escape).join('.*') : escape(query)
  try { return new RegExp(source, caseSensitive ? 'g' : 'gi') } catch { throw new DemoError('정규식 검색어를 확인해 주세요.') }
}

export const handleDemoFiles: DemoHttpHandler = async ({ store, request, url, body, project }) => {
  const route = url.pathname, method = request.method, path = url.searchParams.get('path') ?? ''
  const pageAction = route.match(/^\/api\/docs\/pages\/(create|rename|delete|move|copy)$/)?.[1]
  if (pageAction) {
    requireMethod(request, 'POST')
    const root = store.projectRootPath(project)
    await store.loadFiles(project, path => /\.md$/i.test(path), request.signal)
    requireProjectRoot(store, project, root)
    const pages = new DemoDocumentPages(store, project), target = stringField(body, 'path'), name = stringField(body, 'name')
    return demoJson(pageAction === 'create' ? pages.create(target, name, body.unique === true)
      : pageAction === 'rename' ? pages.rename(target, name)
      : pageAction === 'delete' ? pages.delete(target)
      : pages.relocate(target, stringField(body, 'destination'), pageAction === 'copy'))
  }
  if (route === '/api/tree') {
    requireMethod(request, 'GET')
    const entries = store.tree(project, path, !url.searchParams.has('path') && url.searchParams.get('v') !== '1')
    return demoJson(url.searchParams.get('v') === '1' ? { version: store.revision, state: 'ready', entries } : entries)
  }
  if (route === '/api/file' || route === '/api/fs/file') {
    requireMethod(request, 'GET', 'PUT', 'DELETE')
    const scope = route === '/api/fs/file' ? '.workspace' : project
    if (method === 'GET') {
      const info = store.fileInfo(path, scope)
      const absolute = `${store.workspacePath}/${store.canonicalFilePath(path, scope)}`
      if (url.searchParams.get('version') === info.version.tag) return demoJson({ path: info.path, editable: info.editable, version: info.version, unchanged: true })
      await store.loadFile(absolute, scope, request.signal)
      const file = { ...store.readFile(absolute, scope), path: info.path }
      return demoJson(url.searchParams.has('anchorLine') ? { ...file, partial: false } : file)
    }
    if (method === 'DELETE') { store.deletePath(path, scope); return demoJson({ ok: true, commit: null }) }
    const target = stringField(body, 'path'), content = stringField(body, 'content'), root = store.projectRootPath(scope)
    if (typeof body.expectedContent === 'string' && store.hasFile(target, scope)) await store.loadFile(target, scope, request.signal)
    requireProjectRoot(store, scope, root)
    store.writeFile(target, content, scope, typeof body.expectedContent === 'string' ? body.expectedContent : undefined)
    const commit = body.commit ? store.commit(`Update ${nameOf(target)}`, '', [store.canonicalFilePath(target, scope)]) : null
    return demoJson({ ok: true, path: target, content, commit: commit ? { message: `Update ${nameOf(target)}`, files: [target], hash: commit.hash } : null })
  }
  if (['/api/new-document', '/api/new-folder', '/api/rename', '/api/copy', '/api/copy-into'].includes(route)) {
    requireMethod(request, 'POST')
    let relPath: string
    if (route === '/api/new-document') {
      relPath = stringField(body, 'relPath')
      if (store.hasFile(relPath, project)) throw new DemoError('같은 이름의 파일이 있습니다.', 409)
      const title = stringField(body, 'title', nameOf(relPath).replace(/\.md$/, ''))
      store.writeFile(relPath, relPath.endsWith('.md') ? `# ${title}\n\n` : '', project)
    } else if (route === '/api/new-folder') relPath = store.createDirectory(stringField(body, 'relPath'), project)
    else if (route === '/api/rename') relPath = store.movePath(stringField(body, 'oldPath'), stringField(body, 'newPath'), project)
    else {
      const source = stringField(body, route === '/api/copy' ? 'path' : 'srcPath')
      const destination = route === '/api/copy' ? source : join(stringField(body, 'destDir'), nameOf(source))
      relPath = store.movePath(source, store.uniquePath(destination, project), project, true)
    }
    return demoJson({ ok: true, relPath, hidden: false, commit: null })
  }
  if (route === '/api/fs/dirs' || route === '/api/fs/entries' || route === '/api/agent-cwd/suggestions') {
    requireMethod(request, 'GET')
    const activeRoot = store.workspaceInfo().path
    let requested = path || activeRoot, prefix = ''
    if (route === '/api/agent-cwd/suggestions') {
      const input = url.searchParams.get('input') ?? '', base = url.searchParams.get('base') || activeRoot
      const candidate = input.startsWith('/') ? input : join(base, input)
      if (!input || input.endsWith('/') || url.searchParams.get('entered') === 'true') requested = candidate
      else { requested = directoryOf(candidate); prefix = nameOf(candidate) }
    }
    const absolute = join(store.workspacePath, store.canonicalFilePath(requested))
    const nodes = store.tree('.workspace', requested)
    const dirs = nodes.filter(node => node.type === 'dir' && node.name.toLowerCase().startsWith(prefix.toLowerCase())).map(node => ({ name: node.name, path: join(absolute, node.name) }))
    if (route === '/api/agent-cwd/suggestions') return demoJson({ directory: absolute, prefix, dirs })
    return demoJson(route === '/api/fs/dirs' ? { path: absolute, parent: absolute === store.workspacePath ? null : directoryOf(absolute), dirs } : { path: absolute, canonicalPath: absolute, parent: absolute === store.workspacePath ? null : directoryOf(absolute), entries: nodes.map(node => ({ name: node.name, path: join(absolute, node.name), type: node.type, size: node.type === 'file' ? store.fileInfo(join(absolute, node.name)).size : null })) })
  }
  if (route === '/api/fs/directory' || route === '/api/fs/folder') {
    requireMethod(request, 'POST')
    const target = route === '/api/fs/folder' ? join(stringField(body, 'parent'), stringField(body, 'name')) : stringField(body, 'path')
    const canonical = store.canonicalFilePath(target)
    store.createDirectory(target)
    return demoJson({ ok: true, path: join(store.workspacePath, canonical) })
  }
  if (route === '/api/fs/rename' || route === '/api/fs/paste' || route === '/api/fs/path') {
    requireMethod(request, route === '/api/fs/path' ? 'DELETE' : 'POST')
    if (route === '/api/fs/path') { store.deletePath(path); return demoJson({ ok: true }) }
    const source = stringField(body, route === '/api/fs/paste' ? 'source' : 'path')
    const destination = route === '/api/fs/paste' ? join(stringField(body, 'destination'), nameOf(source)) : join(directoryOf(source), stringField(body, 'name'))
    const canonical = store.canonicalFilePath(destination)
    store.movePath(source, destination, '.workspace', body.mode === 'copy')
    return demoJson({ ok: true, path: join(store.workspacePath, canonical) })
  }
  if (route === '/api/fs/favorites') {
    requireMethod(request, 'GET', 'PUT')
    let folders = store.getState<FileFavorite[]>('favorites', [{ path: store.workspacePath, name: 'mew-playground', kind: 'custom' }])
    if (method === 'PUT') {
      const target = stringField(body, 'path'); store.tree('.workspace', target)
      folders = folders.filter(folder => folder.path !== target)
      if (body.favorite) folders.push({ path: target, name: nameOf(target), kind: 'custom' })
      store.setState('favorites', folders)
    }
    return demoJson(method === 'GET' ? { folders } : { ok: true })
  }
  if (route === '/api/search/files' || route === '/api/search' || route === '/api/search/stream') {
    requireMethod(request, 'GET')
    const query = url.searchParams.get('q') ?? '', filenames = route === '/api/search/files'
    const pattern = queryPattern(query, url.searchParams.get('regex') === '1', url.searchParams.get('case') === '1', filenames)
    const scopes = (url.searchParams.get('scopes') ?? '').split(',').filter(Boolean)
    const files = store.fileMetadata(filenames ? '.workspace' : project).filter(file => !scopes.length || scopes.some(scope => scope === 'root' || scope === '.workspace' || file.path === scope || file.path.startsWith(scope.replace(/^docs$/, 'docs') + '/')))
    if (filenames) return demoJson({ version: store.revision, state: 'ready', results: files.filter(file => { pattern.lastIndex = 0; return pattern.test(file.path) }).slice(0, 50).map(file => ({ path: file.path, project: '.workspace', scope: { id: 'root', label: 'mew-playground', icon: 'folder' } })) })
    const results: { path: string; matches: { line: number; column: number; text: string; matchStart: number; matchEnd: number }[]; project: { id: string; label: string; kind: string } }[] = []
    let truncated = false, matchedLines = 0
    const root = store.projectRootPath(project), candidates = query ? files.filter(file => !file.binary).map(file => ({ ...file, absolute: `${root}/${file.path}` })) : []
    for (let offset = 0; offset < candidates.length; offset += 6) {
      request.signal.throwIfAborted()
      requireProjectRoot(store, project, root)
      const batch = await Promise.all(candidates.slice(offset, offset + 6).map(async file => {
        if (file.size > 2_000_000) { truncated = true; return { file, matches: [] } }
        await store.loadFile(file.absolute, project, request.signal)
        const matches: typeof results[number]['matches'] = []
        const lines = store.readFile(file.absolute, project).content.split('\n')
        for (let index = 0; index < lines.length && matches.length < 1000; index++) {
          pattern.lastIndex = 0
          const match = pattern.exec(lines[index])
          if (match) matches.push({ line: index + 1, column: match.index + 1, text: lines[index], matchStart: match.index, matchEnd: match.index + match[0].length })
        }
        return { file, matches }
      }))
      requireProjectRoot(store, project, root)
      for (const { file, matches } of batch) {
        const selected = matches.slice(0, 1000 - matchedLines)
        if (selected.length) results.push({ path: file.path, matches: selected, project: { id: project, label: project === 'docs' ? 'Documents' : 'mew-playground', kind: project === 'docs' ? 'docs' : 'root' } })
        matchedLines += selected.length
        if (matchedLines >= 1000 || results.length >= 100) { truncated = true; break }
      }
      if (truncated && (matchedLines >= 1000 || results.length >= 100)) break
    }
    if (route === '/api/search/stream') return new Response(results.map(result => `event: result\ndata: ${JSON.stringify(result)}\n\n`).join('') + `event: done\ndata: ${JSON.stringify({ truncated, state: 'ready', version: store.revision, scannedDirtyFiles: 0 })}\n\n`, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
    return demoJson({ results, truncated })
  }
  if (route === '/api/search/replace') {
    requireMethod(request, 'POST')
    const target = stringField(body, 'path'), query = stringField(body, 'query'), root = store.projectRootPath(project)
    await store.loadFile(target, project, request.signal)
    requireProjectRoot(store, project, root)
    const file = store.readFile(target, project)
    if (!query) throw new DemoError('검색어를 입력하세요.')
    const pattern = queryPattern(query, body.regex === true, body.caseSensitive === true)
    let count = 0
    const content = file.content.replace(pattern, () => { count++; return stringField(body, 'replace') })
    if (count) store.writeFile(target, content, project)
    return demoJson({ ok: true, count, commit: null })
  }
  if (route === '/api/table-layout') {
    requireMethod(request, 'GET', 'PUT')
    const target = method === 'GET' ? path : stringField(body, 'path'), key = `tables:${store.canonicalFilePath(target, project)}`
    if (method === 'PUT') store.setState(key, body.tables)
    return demoJson(method === 'GET' ? { tables: store.getState(key, []) } : { ok: true })
  }
  if (route === '/api/frontmatter-options') {
    requireMethod(request, 'GET', 'POST')
    const field = method === 'GET' ? url.searchParams.get('field') ?? '' : stringField(body, 'field'), key = `frontmatter:${store.projectRootPath(project)}:${field}`
    let options = store.getState<string[] | null>(key, null)
    if (method === 'POST') {
      options = [...new Set([...(options ?? stringArray(body, 'seed')), ...stringArray(body, 'add')])].filter(option => !stringArray(body, 'remove').includes(option))
      store.setState(key, options)
      if (body.optionColors) store.setState(`${key}:colors`, body.optionColors)
    }
    return demoJson(url.searchParams.get('colors') === 'true' ? { optionColors: store.getState(`${key}:colors`, {}) } : { options })
  }
  if (route === '/api/docs/backlinks' || route === '/api/docs/graph') {
    requireMethod(request, 'GET')
    const scope = route === '/api/docs/graph' ? 'docs' : project, root = store.projectRootPath(scope)
    await store.loadFiles(scope, path => /\.md$/i.test(path), request.signal)
    requireProjectRoot(store, scope, root)
    const files = store.fileEntries(scope).filter(file => /\.md$/i.test(file.path))
    const nodes = files.map(file => ({ path: file.path, title: titleOf(file.path, file.content), group: directoryOf(file.path) }))
    const edges: [number, number][] = []
    files.forEach((file, source) => {
      for (const match of file.content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = join(directoryOf(file.path), match[1].split('#')[0]).replace(/^\.\//, '')
        const index = nodes.findIndex(node => node.path === target)
        if (index >= 0 && !edges.some(edge => edge[0] === source && edge[1] === index)) edges.push([source, index])
      }
    })
    if (route === '/api/docs/graph') return demoJson({ nodes, edges, skipped: 0 })
    const index = nodes.findIndex(node => node.path === path)
    return demoJson({ documents: edges.filter(edge => edge[1] === index).map(edge => ({ path: nodes[edge[0]].path, title: nodes[edge[0]].title })), parents: [], skipped: 0 })
  }
  if (route === '/api/agent-file-link') {
    requireMethod(request, 'GET')
    let href = (url.searchParams.get('href') ?? '').split('#')[0], line: number | null = null
    const suffix = href.match(/:(\d+)$/)
    if (suffix) { line = Number(suffix[1]); href = href.slice(0, -suffix[0].length) }
    try { const file = store.fileInfo(href); return demoJson({ target: { project: '.workspace', path: file.path, line } }) } catch (error) { if (!(error instanceof DemoError)) throw error; return demoJson({ target: null }) }
  }
  if (route === '/api/agent-cwd') {
    requireMethod(request, 'GET')
    const base = url.searchParams.get('base') || store.workspaceInfo().path, target = path.startsWith('/') ? path : path ? join(base, path) : base
    store.tree('.workspace', target)
    return demoJson({ cwd: join(store.workspacePath, store.canonicalFilePath(target)) })
  }
  if (route === '/api/rules') { requireMethod(request, 'GET'); return demoJson({ archived: false, mocApplicable: false, mocRegistered: true, brokenLinks: [] }) }
  if (route === '/api/lint') { requireMethod(request, 'POST'); return demoJson({ diagnostics: [] }) }
  if (route === '/api/link-preview') { requireMethod(request, 'GET'); return demoJson({ title: null, description: null }) }
  if (route === '/api/upload-into') {
    requireMethod(request, 'POST')
    const form = await request.formData(), file = form.get('file')
    if (!(file instanceof File)) throw new DemoError('파일을 선택하세요.')
    const destination = String(form.get('destDir') ?? ''), scope = String(form.get('project') ?? '.workspace')
    if (file.size > 2_000_000 || (!file.type.startsWith('text/') && !/\.(md|txt|json|ts|tsx|js|jsx|css|html|yaml|yml|csv|svg)$/i.test(file.name))) throw new DemoError('데모에서는 2MB 이하의 텍스트 파일을 가져올 수 있습니다.', 413)
    const relPath = store.uniquePath(join(destination, nameOf(file.name)), scope)
    store.writeFile(relPath, await file.text(), scope)
    return demoJson({ ok: true, relPath, hidden: false, commit: null })
  }
  if (route === '/api/docs/agent-context') {
    requireMethod(request, 'GET')
    return demoJson({ projectRoot: store.workspaceInfo().path, settings: { version: 1, enabled: true, docsDir: 'docs', entrypoints: ['README.md'], instructions: '' } })
  }
  if (route === '/api/docs/metadata') {
    requireMethod(request, 'GET')
    const root = store.projectRootPath('docs')
    await store.loadFiles('docs', path => /\.md$/i.test(path), request.signal)
    requireProjectRoot(store, 'docs', root)
    return demoJson(store.fileEntries('docs').filter(file => /\.md$/i.test(file.path)).map(file => {
      const match = file.content.match(/^---\n([\s\S]*?)\n---/)
      let frontmatter = {}; try { frontmatter = match ? parseYaml(match[1]) ?? {} : {} } catch { /* Invalid frontmatter remains editable in the demo. */ }
      return { path: file.path, title: titleOf(file.path, file.content), frontmatter }
    }))
  }
}
