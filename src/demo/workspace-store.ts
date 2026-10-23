import { createTwoFilesPatch } from 'diff'
import type { DemoRepository, DemoRepositoryEntry } from './repository.ts'
import type { FileVersion } from '../../shared/file-version.ts'
import type { TreeNode } from '../../packages/editor/src/types.ts'
import { DEMO_FILES, DEMO_FILE_PATH, DEMO_USER, DEMO_WORKSPACE_PATH } from './fixtures.ts'
import type { AuthStatus } from '../api/auth.ts'
import type { Capabilities } from '../../shared/access-policy.ts'
import type { FileResponse, GitCommitDetail, GitRepositoryInfo, GitWorkingTreeDetail } from '../api/client.ts'

export type DemoStoreEvent = { type: 'files' | 'git' | 'state' | 'reset' | 'close'; path?: string; project?: string; key?: string }
type DemoContent = string | DemoRepositoryEntry
type DemoFile = { content: DemoContent; revision: number }
export type DemoCommit = GitCommitDetail & { snapshot: Record<string, DemoContent> }

export class DemoError extends Error {
  readonly status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

function normalizePath(path: string): string {
  if (typeof path !== 'string' || path.includes('\0') || path.includes('\\')) throw new DemoError('올바른 데모 경로가 아닙니다.')
  const parts = path.split('/').filter(part => part && part !== '.')
  if (parts.some(part => part === '..')) throw new DemoError('데모 작업 공간 밖의 경로에는 접근할 수 없습니다.', 403)
  return parts.join('/')
}

const parentPath = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const basename = (path: string) => path.split('/').at(-1) ?? ''
const copy = <T>(value: T): T => structuredClone(value)

/** The visitor's files, history, settings and examples have one owner and one lifetime. */
export class DemoWorkspaceStore {
  readonly workspacePath = DEMO_WORKSPACE_PATH
  readonly demoFilePath = DEMO_FILE_PATH
  readonly capabilities: Capabilities = { filesRead: true, filesWrite: true, agent: true, terminal: true, desktop: true, portPreview: true, android: true, serverFiles: true, git: true, database: true, collaboration: true, chat: true, system: true, schedules: true }
  private files = new Map<string, DemoFile>()
  private editedSources = new Map<string, string>()
  private editedSourceIds = new Set<string>()
  private directories = new Set<string>()
  private values = new Map<string, unknown>()
  private listeners = new Set<(event: DemoStoreEvent) => void>()
  private commits: DemoCommit[] = []
  private clock = 1
  private branch = 'main'
  private branches = new Set(['main'])
  private activeRoot = DEMO_WORKSPACE_PATH
  private closed = false

  private repository?: DemoRepository
  constructor(repository?: DemoRepository) { this.repository = repository; this.reset() }

  canonicalFilePath(path: string, project = '.workspace'): string {
    if (path === this.workspacePath || path.startsWith(`${this.workspacePath}/`)) return normalizePath(path.slice(this.workspacePath.length))
    else if (path.startsWith('/')) throw new DemoError('이 폴더는 데모 작업 공간에 없습니다.', 404)
    const base = this.activeRoot.slice(this.workspacePath.length).replace(/^\//, '')
    const prefix = project === 'docs' ? normalizePath(`${base}/docs`) : ['.workspace', 'workspace', 'root', '', 'demo'].includes(project) ? base : normalizePath(`${base}/${project}`)
    return normalizePath(prefix ? `${prefix}/${path}` : path)
  }

  relativeFilePath(path: string, project = '.workspace'): string {
    const base = this.activeRoot.slice(this.workspacePath.length).replace(/^\//, '')
    const prefix = project === 'docs' ? normalizePath(`${base}/docs`) : ['.workspace', 'workspace', 'root', '', 'demo'].includes(project) ? base : normalizePath(`${base}/${project}`)
    return prefix && path.startsWith(`${prefix}/`) ? path.slice(prefix.length + 1) : path
  }

  subscribe(listener: (event: DemoStoreEvent) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  notify(event: DemoStoreEvent): void { if (!this.closed) for (const listener of this.listeners) listener(event) }
  getState<T>(key: string, fallback: T): T { return copy(this.values.has(key) ? this.values.get(key) as T : fallback) }
  setState<T>(key: string, value: T): void { this.values.set(key, copy(value)); this.notify({ type: 'state', key }) }
  deleteState(key: string): void { this.values.delete(key); this.notify({ type: 'state', key }) }
  get revision(): number { return this.clock }
  authStatus(): AuthStatus { return { ...DEMO_USER, ...this.getState('profile', {}), authenticated: true, role: 'owner', mustChangePassword: false, hasPassword: false, authenticationMethod: null, capabilities: { ...this.capabilities }, accessRevision: 'demo-v1' } }

  reset(): void {
    this.closed = false
    this.clock = 1
    this.branch = 'main'; this.branches = new Set(['main']); this.activeRoot = this.workspacePath
    this.repository?.clear()
    this.files.clear(); this.editedSources.clear(); this.editedSourceIds.clear(); this.directories = new Set(['', 'docs', 'src']); this.values.clear()
    for (const [path, entry] of Object.entries(this.repository?.index.files ?? {})) {
      this.ensureParents(path); this.files.set(path, { content: entry, revision: this.clock })
    }
    for (const [path, content] of Object.entries(DEMO_FILES)) {
      this.ensureParents(path)
      this.files.set(path, { content, revision: this.clock })
    }
    const snapshot = this.snapshot()
    this.commits = [{ hash: 'de00000100000000000000000000000000000001', parents: [], refs: ['HEAD -> main'], subject: 'Open Mew demo snapshot', author: 'Demo visitor', email: 'visitor@example.test', date: '2026-10-01T09:00:00.000Z', body: 'Mew source files and documents with a demo welcome page.', files: Object.keys(snapshot).map(path => ({ path, status: 'A' })), snapshot }]
    this.notify({ type: 'reset' })
  }

  close(): void { if (this.closed) return; this.notify({ type: 'close' }); this.closed = true; this.listeners.clear(); this.files.clear(); this.editedSources.clear(); this.editedSourceIds.clear(); this.values.clear(); this.commits = []; this.repository?.clear() }

  private snapshot(): Record<string, DemoContent> { return Object.fromEntries([...this.files].map(([path, file]) => [path, file.content])) }
  private ensureParents(path: string): void {
    let directory = parentPath(path)
    const directories: string[] = []
    while (directory) {
      if (this.files.has(directory)) throw new DemoError('상위 경로에 같은 이름의 파일이 있습니다.', 409)
      directories.push(directory); directory = parentPath(directory)
    }
    for (const candidate of directories) this.directories.add(candidate)
  }
  private changed(path?: string): void { this.clock++; this.notify({ type: 'files', path, project: '.workspace' }); this.notify({ type: 'git', path }) }

  projectRootPath(project = '.workspace'): string {
    const relative = this.canonicalFilePath('', project)
    return this.workspacePath + (relative ? `/${relative}` : '')
  }
  workspaceInfo() { return { path: this.activeRoot, docs: 'docs', docsPath: `${this.activeRoot}/docs`, projects: this.projectNames() } }
  projectNames(): string[] {
    const prefix = `${this.activeRoot}/`
    return this.getState<string[]>('project-roots', []).filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')).map(path => path.slice(prefix.length)).sort((a, b) => a.localeCompare(b))
  }
  registerProject(path: string): void {
    const relative = this.canonicalFilePath(path)
    if (!this.directories.has(relative)) throw new DemoError('데모 폴더를 찾을 수 없습니다.', 404)
    const absolute = this.workspacePath + (relative ? `/${relative}` : '')
    this.setState('project-roots', [...new Set([...this.getState<string[]>('project-roots', []), absolute])])
  }
  seedProject(path: string): void {
    const canonical = this.canonicalFilePath(path), root = `${this.workspacePath}/${canonical}`.replace(/\/$/, '')
    if (!this.directories.has(canonical)) throw new DemoError('데모 폴더를 찾을 수 없습니다.', 404)
    for (const [file, entry] of Object.entries(this.repository?.index.files ?? {})) {
      const target = this.canonicalFilePath(`${root}/${file}`)
      if (!this.files.has(target)) { this.ensureParents(target); this.files.set(target, { content: entry, revision: ++this.clock }) }
    }
    for (const [file, content] of Object.entries(DEMO_FILES)) {
      const target = `${root}/${file}`
      if (!this.hasFile(target) || this.sourceEntry(target)) this.writeFile(target, content)
    }
    this.changed()
    this.registerProject(root)
  }
  openWorkspace(path: string) {
    const relative = this.canonicalFilePath(path)
    if (!this.directories.has(relative)) throw new DemoError('데모 폴더를 찾을 수 없습니다.', 404)
    this.activeRoot = this.workspacePath + (relative ? `/${relative}` : '')
    const docs = normalizePath(`${relative}/docs`)
    if (!this.files.has(docs)) this.directories.add(docs)
    this.notify({ type: 'state', key: 'workspace' })
    return this.workspaceInfo()
  }

  get hasRepository(): boolean { return !!this.repository }
  isFileLoaded(path: string, project = '.workspace'): boolean {
    const content = this.files.get(this.canonicalFilePath(path, project))?.content
    return content !== undefined && (typeof content === 'string' || content.binary || this.editedSources.has(content.oid) || this.repository?.peek(content) !== undefined)
  }
  sourceAssetPath(path: string, project = '.workspace'): string | undefined {
    const entry = this.sourceEntry(path, project)
    if (!entry) return
    const original = Object.entries(this.repository!.index.files).find(([, value]) => value.oid === entry.oid)?.[0] ?? path
    const extension = original.split('.').at(-1)?.toLowerCase() ?? ''
    const native = /^(?:svg|png|jpe?g|gif|webp|avif|ico|pdf|mp3|ogg|wav|mp4|webm|woff2?|ttf|otf|bmp)$/.test(extension)
    return `repository/${entry.oid}.${native ? extension : 'bin'}`
  }
  hasFile(path: string, project = '.workspace'): boolean { return this.files.has(this.canonicalFilePath(path, project)) }
  fileInfo(path: string, project = '.workspace') {
    const canonical = this.canonicalFilePath(path, project), file = this.files.get(canonical)
    if (!file) throw new DemoError('데모 파일을 찾을 수 없습니다.', 404)
    const binary = typeof file.content !== 'string' && file.content.binary
    const size = typeof file.content === 'string' ? new TextEncoder().encode(file.content).byteLength : file.content.size
    return { path: this.relativeFilePath(canonical, project), size, binary, editable: !binary, version: { size, mtimeMs: file.revision, ctimeMs: 1, tag: `demo-${file.revision}` } }
  }
  fileMetadata(project = '.workspace'): { path: string; size: number; binary: boolean }[] {
    const prefix = this.canonicalFilePath('', project)
    return [...this.files.keys()].filter(path => !prefix || path.startsWith(`${prefix}/`)).map(path => {
      const info = this.fileInfo(`${this.workspacePath}/${path}`)
      return { path: this.relativeFilePath(path, project), size: info.size, binary: info.binary }
    })
  }
  repositoryMetadata(): { path: string; size: number; binary: boolean }[] {
    return [...this.files.keys()].map(path => {
      const info = this.fileInfo(`${this.workspacePath}/${path}`)
      return { path, size: info.size, binary: info.binary }
    })
  }
  sourceEntry(path: string, project = '.workspace'): DemoRepositoryEntry | undefined {
    const file = this.files.get(this.canonicalFilePath(path, project))
    return file && typeof file.content !== 'string' ? file.content : undefined
  }
  async loadFile(path: string, project = '.workspace', signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const file = this.files.get(this.canonicalFilePath(path, project))
    if (!file) throw new DemoError('데모 파일을 찾을 수 없습니다.', 404)
    if (typeof file.content !== 'string' && !file.content.binary) await this.loadContent(file.content, signal)
  }
  async loadFiles(project = '.workspace', predicate: (path: string) => boolean = () => true, signal?: AbortSignal): Promise<void> {
    const root = this.projectRootPath(project)
    const files = this.fileMetadata(project).filter(file => !file.binary && predicate(file.path)).map(file => `${root}/${file.path}`)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(6, files.length) }, async () => {
      while (next < files.length) { signal?.throwIfAborted(); await this.loadFile(files[next++], '.workspace', signal) }
    }))
  }
  private async loadContent(content: DemoContent, signal?: AbortSignal): Promise<void> {
    if (typeof content === 'string' || this.editedSources.has(content.oid)) return
    try {
      await this.repository!.load(content, signal)
      if (this.editedSourceIds.has(content.oid)) {
        const original = this.repository!.peek(content)
        if (typeof original === 'string') this.editedSources.set(content.oid, original)
      }
    }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new DemoError(error instanceof Error ? error.message : '데모 파일을 불러오지 못했습니다.', 503)
    }
  }
  private text(content: DemoContent): string {
    if (typeof content === 'string') return content
    if (content.binary) return ''
    const value = this.editedSources.get(content.oid) ?? this.repository?.peek(content)
    if (typeof value !== 'string') throw new DemoError('파일 내용을 먼저 불러와 주세요.', 503)
    return value
  }
  async fileBytes(path: string, project = '.workspace', signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
    const file = this.files.get(this.canonicalFilePath(path, project))
    if (!file) throw new DemoError('데모 파일을 찾을 수 없습니다.', 404)
    await this.loadContent(file.content, signal)
    const value = typeof file.content === 'string' ? file.content : this.editedSources.get(file.content.oid) ?? this.repository!.peek(file.content)!
    return typeof value === 'string' ? new TextEncoder().encode(value) : value.slice()
  }
  readFile(path: string, project = '.workspace'): FileResponse & { version: FileVersion } {
    const canonical = this.canonicalFilePath(path, project), file = this.files.get(canonical)
    const info = this.fileInfo(path, project)
    return { path: info.path, content: this.text(file!.content), editable: info.editable, version: info.version }
  }

  writeFile(path: string, content: string, project = '.workspace', expectedContent?: string): void {
    const canonical = this.canonicalFilePath(path, project)
    if (!canonical || this.directories.has(canonical)) throw new DemoError('파일 경로를 지정하세요.')
    if (typeof content !== 'string' || content.length > 2_000_000) throw new DemoError('데모 파일은 2MB 이하여야 합니다.', 413)
    const previous = this.files.get(canonical)
    if (expectedContent !== undefined && previous && this.text(previous.content) !== expectedContent) throw new DemoError('파일이 다른 곳에서 바뀌었습니다. 최신 내용을 확인해 주세요.', 409)
    if (previous && (previous.content === content || typeof previous.content !== 'string' && this.repository?.peek(previous.content) === content)) return
    if (previous && typeof previous.content !== 'string') {
      this.editedSourceIds.add(previous.content.oid)
      const original = this.repository?.peek(previous.content)
      if (typeof original === 'string') this.editedSources.set(previous.content.oid, original)
    }
    this.ensureParents(canonical)
    this.files.set(canonical, { content, revision: ++this.clock }); this.changed(canonical)
  }

  createDirectory(path: string, project = '.workspace'): string {
    const canonical = this.canonicalFilePath(path, project)
    if (!canonical || this.files.has(canonical) || this.directories.has(canonical)) throw new DemoError('같은 이름의 파일 또는 폴더가 있습니다.', 409)
    this.ensureParents(canonical); this.directories.add(canonical); this.changed(canonical)
    return this.relativeFilePath(canonical, project)
  }

  deletePath(path: string, project = '.workspace'): void {
    const canonical = this.canonicalFilePath(path, project)
    if (!canonical) throw new DemoError('데모 작업 공간 자체는 삭제할 수 없습니다.')
    if (!this.files.has(canonical) && !this.directories.has(canonical)) throw new DemoError('데모 경로를 찾을 수 없습니다.', 404)
    for (const key of this.files.keys()) if (key === canonical || key.startsWith(`${canonical}/`)) this.files.delete(key)
    for (const key of this.directories) if (key === canonical || key.startsWith(`${canonical}/`)) this.directories.delete(key)
    this.changed(canonical)
  }

  movePath(from: string, to: string, project = '.workspace', duplicate = false): string {
    const source = this.canonicalFilePath(from, project), target = this.canonicalFilePath(to, project)
    if (!source || !target || target === source || target.startsWith(`${source}/`)) throw new DemoError('이 위치로 옮길 수 없습니다.')
    if (!this.files.has(source) && !this.directories.has(source)) throw new DemoError('데모 경로를 찾을 수 없습니다.', 404)
    if (this.files.has(target) || this.directories.has(target)) throw new DemoError('같은 이름의 파일 또는 폴더가 있습니다.', 409)
    this.ensureParents(target)
    const entries = [...this.files].filter(([key]) => key === source || key.startsWith(`${source}/`))
    const dirs = [...this.directories].filter(key => key === source || key.startsWith(`${source}/`))
    for (const [key, file] of entries) this.files.set(target + key.slice(source.length), { content: file.content, revision: ++this.clock })
    for (const directory of dirs) this.directories.add(target + directory.slice(source.length))
    if (!duplicate) {
      for (const [key] of entries) this.files.delete(key)
      for (const directory of dirs) this.directories.delete(directory)
    }
    this.changed(target); return this.relativeFilePath(target, project)
  }

  uniquePath(path: string, project = '.workspace'): string {
    const canonical = this.canonicalFilePath(path, project), extension = basename(canonical).includes('.') ? canonical.slice(canonical.lastIndexOf('.')) : ''
    const stem = extension ? canonical.slice(0, -extension.length) : canonical
    let candidate = canonical, index = 1
    while (this.files.has(candidate) || this.directories.has(candidate)) candidate = `${stem} (${++index})${extension}`
    return this.relativeFilePath(candidate, project)
  }

  fileEntries(project = '.workspace'): { path: string; content: string }[] {
    const prefix = this.canonicalFilePath('', project)
    return this.repositoryEntries().filter(file => !prefix || file.path.startsWith(`${prefix}/`)).map(file => ({ path: this.relativeFilePath(file.path, project), get content() { return file.content } }))
  }
  repositoryEntries(): { path: string; content: string }[] {
    return [...this.files].filter(([, file]) => typeof file.content === 'string' || !file.content.binary).map(([path, file]) => {
      const read = () => this.text(file.content)
      return { path, get content() { return read() } }
    })
  }

  tree(project = '.workspace', path = '', recursive = false): TreeNode[] {
    const directory = this.canonicalFilePath(path, project)
    if (!this.directories.has(directory)) throw new DemoError('데모 폴더를 찾을 수 없습니다.', 404)
    const prefix = directory ? `${directory}/` : ''
    const result: TreeNode[] = []
    for (const key of this.directories) if (key && key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
      const relative = this.relativeFilePath(key, project)
      result.push({ type: 'dir', name: basename(key), path: relative, ...(recursive ? { children: this.tree(project, relative, true) } : {}) })
    }
    for (const key of this.files.keys()) if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) result.push({ type: 'file', name: basename(key), path: this.relativeFilePath(key, project), editable: this.fileInfo(`${this.workspacePath}/${key}`).editable })
    return result.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)
  }

  private sameContent(left: DemoContent | undefined, right: DemoContent | undefined): boolean {
    if (left === right) return true
    if (left === undefined || right === undefined) return false
    if (typeof left !== 'string' && typeof right !== 'string') return left.oid === right.oid
    if (typeof left !== 'string') return (this.editedSources.get(left.oid) ?? this.repository?.peek(left)) === right
    return typeof right !== 'string' && (this.editedSources.get(right.oid) ?? this.repository?.peek(right)) === left
  }
  gitWorkingTree(): GitWorkingTreeDetail {
    const head = this.commits[0].snapshot, paths = new Set([...Object.keys(head), ...this.files.keys()])
    return { files: [...paths].filter(path => !this.sameContent(head[path], this.files.get(path)?.content)).map(path => ({ path, status: !this.files.has(path) ? 'D' : !(path in head) ? '?' : 'M' })) }
  }
  gitRepository(): GitRepositoryInfo { return { workspace: this.workspacePath, repository: true, path: this.workspacePath, branch: this.branch, detached: false, dirty: this.gitWorkingTree().files.length > 0, ahead: 0, behind: 0, originUrl: null, remotes: [] } }
  gitLog() { return { commits: this.commits.map(({ snapshot: _snapshot, files: _files, body: _body, ...commit }, index) => ({ ...commit, parents: [...commit.parents], refs: index === 0 ? [`HEAD -> ${this.branch}`] : [] })) } }
  gitCommit(hash: string): DemoCommit { const commit = this.commits.find(item => item.hash === hash); if (!commit) throw new DemoError('데모 커밋을 찾을 수 없습니다.', 404); return copy(commit) }
  private repositoryFilePath(path: string): string { return this.canonicalFilePath(path.startsWith('/') ? path : `${this.workspacePath}/${path}`) }
  gitDiff(file: string, hash?: string): { diff: string } {
    const path = this.repositoryFilePath(file), commit = hash ? this.gitCommit(hash) : undefined
    const before = commit ? (this.commits.find(item => item.hash === commit.parents[0])?.snapshot[path] ?? '') : this.commits[0].snapshot[path] ?? ''
    const after = commit ? commit.snapshot[path] ?? '' : this.files.get(path)?.content ?? ''
    if ([before, after].some(value => typeof value !== 'string' && value.binary)) return { diff: `Binary files a/${path} and b/${path} differ\n` }
    return { diff: createTwoFilesPatch(`a/${path}`, `b/${path}`, this.text(before), this.text(after), '', '', { context: 3 }) }
  }
  async gitFileContent(path: string, hash: string, project = '.workspace', signal?: AbortSignal): Promise<string | undefined> {
    const content = this.gitCommit(hash).snapshot[this.canonicalFilePath(path, project)]
    if (content === undefined) return
    if (!(typeof content !== 'string' && content.binary)) await this.loadContent(content, signal)
    return this.text(content)
  }
  async loadDiff(file: string, hash?: string, signal?: AbortSignal): Promise<void> {
    const path = this.repositoryFilePath(file), commit = hash ? this.gitCommit(hash) : undefined
    const before = commit ? this.commits.find(item => item.hash === commit.parents[0])?.snapshot[path] : this.commits[0].snapshot[path]
    const after = commit ? commit.snapshot[path] : this.files.get(path)?.content
    for (const value of [before, after]) if (value !== undefined && !(typeof value !== 'string' && value.binary)) await this.loadContent(value, signal)
  }
  commit(title: string, description = '', selected?: string[]) {
    if (!title.trim()) throw new DemoError('커밋 제목을 입력하세요.')
    const changes = this.gitWorkingTree().files.filter(file => !selected || selected.includes(file.path))
    if (!changes.length) throw new DemoError('커밋할 변경이 없습니다.', 409)
    const snapshot = { ...this.commits[0].snapshot }
    for (const change of changes) { const file = this.files.get(change.path); if (file) snapshot[change.path] = file.content; else delete snapshot[change.path] }
    const hash = `de${(++this.clock).toString(16).padStart(38, '0')}`
    this.commits.unshift({ hash, parents: [this.commits[0].hash], refs: [], subject: title.trim(), author: 'Demo visitor', email: 'visitor@example.test', date: new Date().toISOString(), body: description, files: changes.map(file => ({ ...file, status: file.status === '?' ? 'A' : file.status })), snapshot })
    this.notify({ type: 'git' })
    return { info: this.gitRepository(), hash }
  }
  discard(files: string[]): void {
    const head = this.commits[0].snapshot
    for (const selected of files) {
      const path = this.repositoryFilePath(selected)
      if (path in head) { this.ensureParents(path); this.files.set(path, { content: head[path], revision: ++this.clock }) }
      else this.files.delete(path)
    }
    this.changed()
  }
  gitBranches() { return { branches: [...this.branches].map(name => ({ name, ref: `refs/heads/${name}`, kind: 'local' as const })) } }
  setBranch(name: string, create = false) {
    if (!/^[\w][\w./-]*$/.test(name) || name.includes('..')) throw new DemoError('브랜치 이름을 확인해 주세요.')
    if (!create && !this.branches.has(name)) throw new DemoError('데모 브랜치를 찾을 수 없습니다.', 404)
    this.branches.add(name); this.branch = name; this.notify({ type: 'git' }); return this.gitRepository()
  }
}
