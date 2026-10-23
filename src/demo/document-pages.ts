import { documentPageTarget, pageRepresentative, representativeName, rewritePageLinks, type DocumentPageMove, type DocumentPageMutation } from '../../shared/document-pages.ts'
import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'

const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
const nameOf = (path: string) => path.split('/').at(-1) ?? ''
const join = (parent: string, name: string) => parent ? `${parent}/${name}` : name
const pageContent = (title: string) => {
  const today = new Date().toISOString().slice(0, 10)
  return `---\ntitle: ${JSON.stringify(title)}\ncreated: ${today}\nupdated: ${today}\ndescription: ${JSON.stringify(title)}\n---\n\n`
}
type Origin = { path: string; content: string; moves: DocumentPageMove[] }

/** Plan page changes in memory before publishing them to the shared demo workspace. */
export class DemoDocumentPages {
  private files = new Map<string, string | undefined>()
  private directories = new Set([''])
  private origins = new Map<string, Origin>()
  private initialFiles: Map<string, string | undefined>
  private initialDirectories: Set<string>
  private moves: DocumentPageMove[] = []
  private removed?: { path: string; directory: boolean }
  private operations: (() => void)[] = []
  private store: DemoWorkspaceStore
  private project: string

  constructor(store: DemoWorkspaceStore, project = 'docs') {
    this.store = store; this.project = project
    for (const file of store.fileMetadata(project)) {
      const content = /\.md$/i.test(file.path) && !file.binary ? store.readFile(file.path, project).content : undefined
      this.files.set(file.path, content)
      if (content !== undefined) this.origins.set(file.path, { path: file.path, content, moves: [] })
    }
    const collect = (directory: string) => {
      for (const entry of store.tree(project, directory)) if (entry.type === 'dir') { this.directories.add(entry.path); collect(entry.path) }
    }
    collect('')
    this.initialFiles = new Map(this.files)
    this.initialDirectories = new Set(this.directories)
  }

  private validate(path: string, root = false): void {
    if ((!path && !root) || path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(part => part === '.' || part === '..' || part.startsWith('.'))) throw new DemoError('올바른 문서 경로가 아닙니다.')
    if (path === 'archives' || path.startsWith('archives/')) throw new DemoError('archives/ 문서는 변경할 수 없습니다.', 403)
  }
  private exists(path: string): boolean { return this.files.has(path) || this.directories.has(path) }
  private require(path: string): void { this.validate(path); if (!this.exists(path)) throw new DemoError('데모 문서를 찾을 수 없습니다.', 404) }
  private available(path: string): void { this.validate(path); if (this.exists(path)) throw new DemoError('같은 이름의 문서가 있습니다.', 409) }
  private representative(directory: string): string | undefined {
    const nodes = [...this.files.keys()].filter(file => parentOf(file) === directory).map(path => ({ name: nameOf(path), type: 'file', path }))
    return pageRepresentative(directory, nodes)?.path
  }
  private logical(path: string): string {
    this.validate(path, true)
    const directory = documentPageTarget(path)
    return directory !== path && directory && this.representative(directory) === path ? directory : path
  }
  private name(raw: string): string {
    const name = raw.trim().replace(/\.md$/i, '')
    if (!name || name.startsWith('_') || /[/\\]/.test(name) || name.includes('\0') || name === '.' || name === '..' || name.startsWith('.')) throw new DemoError('올바른 문서 이름을 입력하세요.')
    return name
  }
  private ensureParents(path: string): void {
    for (let directory = parentOf(path); directory; directory = parentOf(directory)) {
      if (this.files.has(directory)) throw new DemoError('상위 경로에 같은 이름의 파일이 있습니다.', 409)
      this.directories.add(directory)
    }
  }
  private createFile(path: string, title: string): void { this.available(path); this.ensureParents(path); this.files.set(path, pageContent(title)) }
  private transfer(source: string, target: string, duplicate = false, copiedMoves: DocumentPageMove[] = []): void {
    this.require(source); this.available(target)
    if (target.startsWith(`${source}/`)) throw new DemoError('문서를 자기 자신 안으로 옮길 수 없습니다.')
    this.ensureParents(target)
    const files = [...this.files].filter(([path]) => path === source || path.startsWith(`${source}/`))
    const directories = [...this.directories].filter(path => path === source || path.startsWith(`${source}/`))
    for (const [path, content] of files) {
      const next = target + path.slice(source.length)
      this.files.set(next, content)
      const origin = this.origins.get(path)
      if (origin) this.origins.set(next, { ...origin, moves: [...copiedMoves, ...origin.moves] })
      if (!duplicate) { this.files.delete(path); this.origins.delete(path) }
    }
    for (const path of directories) { this.directories.add(target + path.slice(source.length)); if (!duplicate) this.directories.delete(path) }
    this.operations.push(() => { this.store.movePath(source, target, this.project, duplicate) })
  }
  private move(source: string, target: string, directory = false): void {
    this.transfer(source, target)
    this.moves.push({ from: source, to: target, ...(directory ? { directory: true } : {}) })
  }
  private promote(target: string): string {
    target = this.logical(target)
    if (!target) return ''
    this.require(target)
    let directory = target
    if (this.files.has(target)) {
      if (!/\.md$/i.test(target)) throw new DemoError('Markdown 문서에만 하위 문서를 추가할 수 있습니다.')
      directory = target.slice(0, -3)
      this.available(directory)
      this.move(target, join(directory, representativeName(directory)))
    } else {
      const representative = this.representative(directory), canonical = join(directory, representativeName(directory))
      if (!representative) this.createFile(canonical, nameOf(directory))
      else if (representative !== canonical) this.move(representative, canonical)
    }
    return directory
  }
  private demote(directory: string): void {
    if (!directory) return
    const representative = join(directory, representativeName(directory))
    const rest = [...this.files.keys(), ...this.directories].some(path => path !== representative && path !== directory && path.startsWith(`${directory}/`))
    if (this.files.has(representative) && !rest) { this.move(representative, `${directory}.md`); this.directories.delete(directory) }
  }
  private commit(path: string): DocumentPageMutation {
    for (const [target, origin] of this.origins) if (this.files.has(target)) this.files.set(target, rewritePageLinks(origin.content, origin.path, target, [...origin.moves, ...this.moves]))
    const changed = new Set<string>([...this.moves.flatMap(move => [move.from, move.to]), ...(this.removed ? [this.removed.path] : [])])
    for (const [file, content] of this.initialFiles) if (this.files.get(file) !== content) changed.add(file)
    for (const [file, content] of this.files) if (this.initialFiles.get(file) !== content) changed.add(file)
    for (const operation of this.operations) operation()
    for (const directory of [...this.initialDirectories].sort((a, b) => b.length - a.length)) if (directory && !this.directories.has(directory)) {
      try { this.store.deletePath(directory, this.project) } catch (error) { if (!(error instanceof DemoError) || error.status !== 404) throw error }
    }
    for (const directory of [...this.directories].sort((a, b) => a.length - b.length)) if (!this.initialDirectories.has(directory)) {
      try { this.store.tree(this.project, directory) } catch (error) { if (!(error instanceof DemoError) || error.status !== 404) throw error; this.store.createDirectory(directory, this.project) }
    }
    for (const file of changed) {
      const content = this.files.get(file)
      if (content !== undefined) this.store.writeFile(file, content, this.project)
    }
    return { path, moves: this.moves, changed: [...changed], ...(this.removed ? { removed: this.removed } : {}) }
  }

  create(parent: string, rawName: string, unique = false): DocumentPageMutation {
    const directory = this.promote(parent), name = this.name(rawName)
    let target = join(directory, `${name}.md`), suffix = 2
    if (unique) while (this.exists(target) || this.exists(target.slice(0, -3))) target = join(directory, `${name} ${suffix++}.md`)
    if (this.exists(target.slice(0, -3))) throw new DemoError('같은 이름의 상위 문서가 있습니다.', 409)
    this.createFile(target, nameOf(target).replace(/\.md$/i, ''))
    return this.commit(target)
  }
  rename(target: string, rawName: string): DocumentPageMutation {
    target = this.logical(target); this.require(target)
    const name = this.name(rawName), directory = this.directories.has(target), next = join(parentOf(target), name + (directory ? '' : '.md'))
    if (!directory && !/\.md$/i.test(target)) throw new DemoError('Markdown 문서만 이름을 바꿀 수 있습니다.')
    if (next === target) return { path: this.representative(target) ?? target, moves: [], changed: [] }
    if (this.exists(directory ? `${next}.md` : next.slice(0, -3))) throw new DemoError('같은 이름의 문서가 있습니다.', 409)
    const representative = directory ? this.representative(target) : undefined
    this.move(target, next, directory)
    if (directory) {
      const canonical = join(next, representativeName(next))
      if (representative) {
        const transferred = next + representative.slice(target.length)
        this.transfer(transferred, canonical)
        this.moves.unshift({ from: representative, to: canonical })
      } else this.createFile(canonical, name)
    }
    return this.commit(directory ? join(next, representativeName(next)) : next)
  }
  delete(target: string): DocumentPageMutation {
    target = this.logical(target); this.require(target)
    const directory = this.directories.has(target)
    this.removed = { path: target, directory }
    const removed = target
    this.operations.push(() => { this.store.deletePath(removed, this.project) })
    for (const path of [...this.files.keys()]) if (path === target || directory && path.startsWith(`${target}/`)) { this.files.delete(path); this.origins.delete(path) }
    for (const path of [...this.directories]) if (path === target || directory && path.startsWith(`${target}/`)) this.directories.delete(path)
    this.demote(parentOf(target))
    return this.commit(this.moves[0]?.to ?? '')
  }
  relocate(source: string, destination: string, duplicate = false): DocumentPageMutation {
    source = this.logical(source); destination = this.logical(destination); this.require(source)
    const directory = this.directories.has(source)
    if (source === destination || directory && destination.startsWith(`${source}/`)) throw new DemoError('문서를 자기 자신 안으로 옮길 수 없습니다.')
    if (!directory && !/\.md$/i.test(source)) throw new DemoError('Markdown 문서만 이동할 수 있습니다.')
    const dest = this.promote(destination), stem = nameOf(source).replace(/\.md$/i, '')
    let target = join(dest, stem + (directory ? '' : '.md')), index = 0
    if (!duplicate && target === source) return { path: source, moves: [], changed: [] }
    if (duplicate) while (this.exists(target) || this.exists(directory ? `${target}.md` : target.slice(0, -3))) {
      target = join(dest, `${stem} copy${index ? ` ${index + 1}` : ''}${directory ? '' : '.md'}`); index++
    }
    if (this.exists(directory ? `${target}.md` : target.slice(0, -3))) throw new DemoError('같은 이름의 문서가 있습니다.', 409)
    const representative = directory ? this.representative(source) : undefined
    const canonical = join(target, representativeName(target))
    const copyMoves: DocumentPageMove[] = [{ from: source, to: target, ...(directory ? { directory: true } : {}) }]
    if (representative) copyMoves.unshift({ from: representative, to: canonical })
    if (duplicate) this.transfer(source, target, true, copyMoves)
    else this.move(source, target, directory)
    if (directory) {
      if (representative) {
        const transferred = target + representative.slice(source.length)
        if (transferred !== canonical) this.transfer(transferred, canonical)
        if (!duplicate) this.moves.unshift({ from: representative, to: canonical })
      } else this.createFile(canonical, stem)
    }
    if (!duplicate) this.demote(parentOf(source))
    return this.commit(directory ? canonical : target)
  }
}
