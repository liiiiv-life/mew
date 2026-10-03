import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ConflictError } from './documents.ts'
import { buildFrontmatter } from './frontmatter.ts'
import { isDeniedSegment } from './paths.ts'
import { documentPageTarget, pageRepresentative, representativeName, remapPagePath, rewritePageLinks, type DocumentPageMove, type DocumentPageMutation } from '../shared/document-pages.ts'

export class DocumentPageError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status } }
type Access = (rel: string, recursive?: boolean) => boolean

/** File-backed page operations are preflighted, then rolled back together on any disk failure. */
export class DocumentPages {
  private root: string
  private allowed: Access
  constructor(root: string, allowed: Access = () => true) { this.root = fs.realpathSync(root); this.allowed = allowed }
  private abs(rel: string): string {
    if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.includes('\0') || rel.split('/').some(part => part === '..' || isDeniedSegment(part))) throw new DocumentPageError('올바른 문서 경로가 아닙니다')
    const absolute = path.resolve(this.root, rel)
    if (!absolute.startsWith(this.root + path.sep)) throw new DocumentPageError('문서 폴더 밖으로 이동할 수 없습니다')
    let ancestor = absolute
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor)
    const real = fs.realpathSync(ancestor)
    if (real !== this.root && !real.startsWith(this.root + path.sep)) throw new DocumentPageError('문서 폴더 밖으로 이동할 수 없습니다')
    return absolute
  }
  private writable(rel: string, recursive = false): void {
    this.abs(rel)
    if (rel === 'archives' || rel.startsWith('archives/')) throw new DocumentPageError('archives/ 문서는 변경할 수 없습니다', 403)
    if (!this.allowed(rel, recursive)) throw new DocumentPageError('이 문서를 변경할 권한이 없습니다', 403)
  }
  private representative(dir: string): string | null {
    const nodes = fs.readdirSync(this.abs(dir), { withFileTypes: true }).map(entry => ({ name: entry.name, type: entry.isFile() ? 'file' : 'dir' }))
    const rep = pageRepresentative(dir, nodes)
    return rep ? `${dir}/${rep.name}` : null
  }
  private logicalTarget(rel: string): string {
    const parent = documentPageTarget(rel)
    if (parent === rel || !parent) return parent
    return this.representative(parent) === rel ? parent : rel
  }
  private name(raw: string): string {
    const name = raw.trim().replace(/\.md$/i, '')
    if (!name || name === '.' || name === '..' || name.startsWith('_') || /[\\/]/.test(name) || name.includes('\0') || isDeniedSegment(name)) throw new DocumentPageError('올바른 문서 이름을 입력하세요')
    return name
  }
  private markdownFiles(dir = ''): string[] {
    const files: string[] = []
    for (const entry of fs.readdirSync(dir ? this.abs(dir) : this.root, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || isDeniedSegment(entry.name)) continue
      const rel = dir ? `${dir}/${entry.name}` : entry.name
      if (rel === 'archives') continue
      if (entry.isDirectory()) files.push(...this.markdownFiles(rel))
      else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(rel)
    }
    return files
  }
  private commit(moves: DocumentPageMove[], creations: Map<string, string>, resultPath: string, removed?: { path: string; directory: boolean }, directoryMoves: [string, string][] = [], copies: [string, string][] = []): DocumentPageMutation {
    // Directory moves run first; representative renames then use their new physical parent.
    const operations: [string, string][] = [...directoryMoves]
    for (const move of moves) if (!move.directory) {
      const from = remapPagePath(move.from, directoryMoves.map(([from, to]) => ({ from, to, directory: true })))
      operations.push([from, move.to])
    }
    for (const [from, to] of operations) { this.writable(from, fs.existsSync(this.abs(from)) && fs.statSync(this.abs(from)).isDirectory()); this.writable(to, true); if (fs.existsSync(this.abs(to))) throw new ConflictError(`이미 존재하는 문서입니다: ${to}`) }
    for (const [from, to] of copies) { this.writable(from, true); this.writable(to, true); if (fs.existsSync(this.abs(to))) throw new ConflictError(`이미 존재하는 문서입니다: ${to}`) }
    if (removed) this.writable(removed.path, removed.directory)
    for (const rel of creations.keys()) { this.writable(rel); if (fs.existsSync(this.abs(rel))) throw new ConflictError(`이미 존재하는 문서입니다: ${rel}`) }
    const updates = new Map<string, string>()
    for (const rel of this.markdownFiles()) {
      if (removed && (rel === removed.path || removed.directory && rel.startsWith(`${removed.path}/`))) continue
      const next = remapPagePath(rel, moves)
      if (!this.allowed(rel) || !this.allowed(next)) continue
      const before = fs.readFileSync(this.abs(rel), 'utf8'), after = rewritePageLinks(before, rel, next, moves)
      if (before !== after) updates.set(next, after)
    }
    const copyRepresentatives: [string, string][] = []
    for (const [from, to] of copies) {
      const directory = fs.statSync(this.abs(from)).isDirectory()
      const rep = directory ? this.representative(from) : null
      const copyMoves: DocumentPageMove[] = [{ from, to, directory }]
      if (rep) {
        const copied = to + rep.slice(from.length), canonical = `${to}/${representativeName(to)}`
        copyMoves.unshift({ from: rep, to: canonical })
        if (copied !== canonical) copyRepresentatives.push([copied, canonical])
      } else if (directory) creations.set(`${to}/${representativeName(to)}`, buildFrontmatter(path.posix.basename(to)))
      for (const rel of this.markdownFiles().filter(rel => rel === from || directory && rel.startsWith(`${from}/`))) {
        const next = remapPagePath(rel, copyMoves)
        updates.set(next, rewritePageLinks(fs.readFileSync(this.abs(rel), 'utf8'), rel, next, [...copyMoves, ...moves]))
      }
    }
    const undo: (() => void)[] = [], madeDirs: string[] = []
    const ensureParent = (absolute: string) => {
      const missing: string[] = []; let dir = path.dirname(absolute)
      while (!fs.existsSync(dir)) { missing.push(dir); dir = path.dirname(dir) }
      for (const dir of missing.reverse()) { fs.mkdirSync(dir); madeDirs.push(dir) }
    }
    let staged: string | null = null
    try {
      // Removing the final child can remove its containing directory during demotion.
      if (removed) {
        staged = path.join(this.root, `.page-operation-${randomUUID()}`)
        fs.renameSync(this.abs(removed.path), staged)
        undo.push(() => { ensureParent(this.abs(removed.path)); fs.renameSync(staged!, this.abs(removed.path)) })
      }
      for (const [from, to] of operations) {
        if (fs.existsSync(this.abs(to))) throw new ConflictError(`이미 존재하는 문서입니다: ${to}`)
        ensureParent(this.abs(to)); fs.renameSync(this.abs(from), this.abs(to))
        undo.push(() => { ensureParent(this.abs(from)); fs.renameSync(this.abs(to), this.abs(from)) })
      }
      for (const [from, to] of copies) {
        ensureParent(this.abs(to))
        undo.push(() => fs.rmSync(this.abs(to), { recursive: true, force: true }))
        fs.cpSync(this.abs(from), this.abs(to), { recursive: true, errorOnExist: true, force: false })
      }
      for (const [from, to] of copyRepresentatives) {
        if (fs.existsSync(this.abs(to))) throw new ConflictError(`이미 존재하는 문서입니다: ${to}`)
        fs.renameSync(this.abs(from), this.abs(to))
      }
      for (const [rel, content] of [...creations, ...updates]) {
        const absolute = this.abs(rel), before = fs.existsSync(absolute) ? fs.readFileSync(absolute) : null
        if (creations.has(rel) && before !== null) throw new ConflictError(`이미 존재하는 문서입니다: ${rel}`)
        ensureParent(absolute)
        undo.push(() => { if (before) fs.writeFileSync(absolute, before); else fs.rmSync(absolute, { force: true }) })
        fs.writeFileSync(absolute, content, { flag: before ? 'w' : 'wx' })
      }
      // Demoted page directories are emptied by the representative move.
      const emptyDirs = moves.filter(move => !move.directory && path.posix.dirname(move.from) !== path.posix.dirname(move.to)).map(move => path.posix.dirname(move.from))
      for (const dir of emptyDirs) if (dir !== '.' && fs.existsSync(this.abs(dir)) && fs.readdirSync(this.abs(dir)).length === 0) { fs.rmdirSync(this.abs(dir)); undo.push(() => fs.mkdirSync(this.abs(dir), { recursive: true })) }
      if (staged) fs.rmSync(staged, { recursive: true, force: true })
      return { path: resultPath, moves, changed: [...new Set([...moves.flatMap(move => [move.from, move.to]), ...creations.keys(), ...updates.keys(), ...copies.map(([, to]) => to), ...(removed ? [removed.path] : [])])], ...(removed ? { removed } : {}) }
    } catch (error) {
      for (const revert of undo.reverse()) { try { revert() } catch { /* Preserve the original failure; staged files remain recoverable. */ } }
      for (const dir of madeDirs.reverse()) { try { fs.rmdirSync(dir) } catch { /* Restored data can keep an ancestor nonempty. */ } }
      throw error
    }
  }
  create(parent: string, rawName: string): DocumentPageMutation {
    parent = this.logicalTarget(parent)
    const name = this.name(rawName), moves: DocumentPageMove[] = [], creations = new Map<string, string>()
    let dir = parent
    if (parent) {
      this.writable(parent, true)
      const stat = fs.statSync(this.abs(parent))
      if (stat.isFile()) {
        if (!/\.md$/i.test(parent)) throw new DocumentPageError('Markdown 문서에만 하위 문서를 추가할 수 있습니다')
        dir = parent.slice(0, -3)
        if (fs.existsSync(this.abs(dir))) throw new ConflictError(`같은 이름의 폴더가 이미 있습니다: ${dir}`)
        moves.push({ from: parent, to: `${dir}/${representativeName(dir)}` })
      } else {
        const current = this.representative(dir), canonical = `${dir}/${representativeName(dir)}`
        if (!current) creations.set(canonical, buildFrontmatter(path.posix.basename(dir)))
        else if (current !== canonical) moves.push({ from: current, to: canonical })
      }
    }
    const child = `${dir ? dir + '/' : ''}${name}.md`
    // A leaf and an existing parent page cannot share the same logical name.
    if (fs.existsSync(this.abs(child.slice(0, -3)))) throw new ConflictError(`같은 이름의 상위 문서가 이미 있습니다: ${name}`)
    creations.set(child, buildFrontmatter(name))
    return this.commit(moves, creations, child)
  }
  private demotion(parent: string, removing: string): DocumentPageMove[] {
    if (!parent || parent === '.') return []
    const rep = `${parent}/${representativeName(parent)}`
    if (!fs.existsSync(this.abs(rep))) return []
    const rest = fs.readdirSync(this.abs(parent)).filter(name => `${parent}/${name}` !== rep && `${parent}/${name}` !== removing)
    if (rest.length) return []
    return [{ from: rep, to: `${parent}.md` }]
  }
  delete(target: string): DocumentPageMutation {
    target = this.logicalTarget(target)
    this.writable(target, true)
    const directory = fs.statSync(this.abs(target)).isDirectory()
    const parent = path.posix.dirname(target), moves = this.demotion(parent, target)
    return this.commit(moves, new Map(), moves[0]?.to ?? '', { path: target, directory })
  }
  rename(target: string, rawName: string): DocumentPageMutation {
    target = this.logicalTarget(target)
    this.writable(target, true)
    const name = this.name(rawName), dir = fs.statSync(this.abs(target)).isDirectory(), parent = path.posix.dirname(target)
    if (!dir && !/\.md$/i.test(target)) throw new DocumentPageError('Markdown 문서만 이름을 바꿀 수 있습니다')
    const next = `${parent === '.' ? '' : parent + '/'}${name}${dir ? '' : '.md'}`
    if (next === target) return { path: dir ? this.representative(target) ?? target : target, moves: [], changed: [] }
    if (fs.existsSync(this.abs(dir ? `${next}.md` : next.slice(0, -3)))) throw new ConflictError('같은 이름의 문서가 이미 있습니다')
    const moves: DocumentPageMove[] = [{ from: target, to: next, directory: dir }]
    const creations = new Map<string, string>()
    if (dir) {
      const oldRep = this.representative(target), canonical = `${next}/${representativeName(next)}`
      if (oldRep) moves.unshift({ from: oldRep, to: canonical })
      else creations.set(canonical, buildFrontmatter(name))
    }
    return this.commit(moves, creations, dir ? `${next}/${representativeName(next)}` : next, undefined, dir ? [[target, next]] : [])
  }
  move(source: string, destination: string, copy = false): DocumentPageMutation {
    source = this.logicalTarget(source)
    destination = this.logicalTarget(destination)
    this.writable(source, true)
    const directory = fs.statSync(this.abs(source)).isDirectory(), moves: DocumentPageMove[] = [], creations = new Map<string, string>()
    if (!directory && !/\.md$/i.test(source)) throw new DocumentPageError('Markdown 문서만 이동할 수 있습니다')
    if (source === destination || directory && destination.startsWith(`${source}/`)) throw new DocumentPageError('문서를 자기 자신 안으로 옮길 수 없습니다')
    let dest = destination
    if (dest) {
      this.writable(dest, true)
      if (fs.statSync(this.abs(dest)).isFile()) {
        if (!/\.md$/i.test(dest)) throw new DocumentPageError('Markdown 문서에만 하위 문서를 추가할 수 있습니다')
        dest = dest.slice(0, -3)
        if (fs.existsSync(this.abs(dest))) throw new ConflictError('같은 이름의 폴더가 이미 있습니다')
        moves.push({ from: destination, to: `${dest}/${representativeName(dest)}` })
      } else {
        const rep = this.representative(dest), canonical = `${dest}/${representativeName(dest)}`
        if (!rep) creations.set(canonical, buildFrontmatter(path.posix.basename(dest)))
        else if (rep !== canonical) moves.push({ from: rep, to: canonical })
      }
    }
    const originalName = path.posix.basename(source).replace(/\.md$/i, '')
    let target = `${dest ? dest + '/' : ''}${originalName}${directory ? '' : '.md'}`
    if (!copy && target === source) return { path: source, moves: [], changed: [] }
    if (copy) {
      for (let i = 0; fs.existsSync(this.abs(target)) || fs.existsSync(this.abs(directory ? `${target}.md` : target.slice(0, -3))); i++) {
        if (i > 99) throw new ConflictError('복사할 문서 이름을 만들 수 없습니다')
        target = `${dest ? dest + '/' : ''}${originalName} copy${i ? ' ' + (i + 1) : ''}${directory ? '' : '.md'}`
      }
    }
    if (!copy && fs.existsSync(this.abs(directory ? `${target}.md` : target.slice(0, -3)))) throw new ConflictError('같은 이름의 문서가 이미 있습니다')
    if (!copy) {
      if (directory) {
        const rep = this.representative(source), canonical = `${target}/${representativeName(target)}`
        if (rep && `${target}${rep.slice(source.length)}` !== canonical) moves.push({ from: rep, to: canonical })
        else if (!rep) creations.set(canonical, buildFrontmatter(originalName))
      }
      moves.push({ from: source, to: target, directory })
      moves.push(...this.demotion(path.posix.dirname(source), source))
    }
    const result = directory ? `${target}/${representativeName(target)}` : target
    return this.commit(moves, creations, result, undefined, !copy && directory ? [[source, target]] : [], copy ? [[source, target]] : [])
  }

}
