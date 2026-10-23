import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import { activeFeatureRun, pendingFeatureRun, featureSpecification, type Feature, type FeatureReport, type FeatureRequest, type FeatureRun, type FeatureWorkspace } from '../shared/features.ts'
import { FeatureError } from './feature-error.ts'
import { applyDocumentWrites, documentVersion, featureDocsDir, mergeFeatureReport, parseFeatureDocument, readFeatureDocuments, serializeFeature, validateHierarchy, type DocumentWrite } from './feature-documents.ts'
import { featureDocumentPaths, featureTreeWrites } from './feature-document-tree.ts'
export { FeatureError } from './feature-error.ts'

type RuntimeState = { version: 2; workspace: string; docsDir: string; revision: number; runs: FeatureRun[]; pendingWrites?: DocumentWrite[] }
const uuid = /^[a-f0-9-]{36}$/
const now = () => new Date().toISOString()
function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new FeatureError(`${label}을 확인하세요 (최대 ${max}자)`)
  return value.trim()
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FeatureError('입력 형식을 확인하세요')
  return value as Record<string, unknown>
}
function featureOf(data: FeatureWorkspace, id: unknown): Feature {
  const feature = data.features.find(item => item.id === id)
  if (!feature) throw new FeatureError('기능을 찾을 수 없습니다', 404)
  return feature
}
function runOf(data: FeatureWorkspace, id: string): FeatureRun {
  const run = data.runs.find(item => item.id === id)
  if (!run) throw new FeatureError('요청을 찾을 수 없습니다', 404)
  return run
}
function checkVersion(feature: Feature, version: unknown) {
  if (version !== feature.version) throw new FeatureError('다른 변경사항이 있습니다. 최신 내용을 확인한 뒤 다시 저장하세요.', 409)
}
function touch(feature: Feature) { feature.version++; feature.updatedAt = now() }
function relativePath(value: unknown, allowRoot = false): string {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || value.includes('\\') || path.isAbsolute(value)
    || value.split('/').some(part => part === '..') || (!allowRoot && (!value || value === '.'))) throw new FeatureError('프로젝트 내부의 상대 경로를 사용하세요')
  return value === '.' ? '' : value.replace(/\/$/, '')
}
/** Follow existing ancestors for removed files too, without permitting a symlink escape. */
function inside(root: string, relative: string): string {
  const absolute = path.resolve(root, relative)
  let existing = absolute
  while (!fs.existsSync(existing) && existing !== path.dirname(existing)) existing = path.dirname(existing)
  const real = fs.realpathSync(existing), diff = path.relative(root, real)
  if (diff === '..' || diff.startsWith(`..${path.sep}`) || path.isAbsolute(diff)) throw new FeatureError('프로젝트 밖 파일은 연결할 수 없습니다')
  return absolute
}
function git(cwd: string, args: string[]): string {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  catch { throw new FeatureError('관련 Git 저장소와 커밋을 확인하세요') }
}
export function validateFeatureReport(workspace: string, value: unknown): FeatureReport {
  const input = record(value)
  const summary = text(input.summary, '구현 내용', 40_000), validation = text(input.validation ?? '', '검증 내용', 20_000, false)
  if (!Array.isArray(input.files) || input.files.length > 500 || !Array.isArray(input.commits) || input.commits.length > 200) throw new FeatureError('파일·커밋 목록을 확인하세요')
  const commits = input.commits.map(item => {
    const entry = record(item), repository = relativePath(entry.repository, true), cwd = inside(workspace, repository)
    const hash = text(entry.hash, '커밋 해시', 64)
    if (!/^[0-9a-f]{7,64}$/i.test(hash)) throw new FeatureError('커밋 해시를 확인하세요')
    if (fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel'])) !== fs.realpathSync(cwd)) throw new FeatureError('저장소 루트 경로를 사용하세요')
    return { repository, hash: git(cwd, ['rev-parse', '--verify', `${hash}^{commit}`]), subject: git(cwd, ['show', '-s', '--format=%s', hash]).slice(0, 1000) }
  })
  const files = [...new Set(input.files.map(item => relativePath(item)))].map(file => {
    const absolute = inside(workspace, file)
    if (fs.existsSync(absolute)) {
      if (!fs.statSync(absolute).isFile()) throw new FeatureError('관련 파일에는 파일 경로만 넣으세요')
    } else {
      // A deleted file is valid only when an actual linked commit records its deletion.
      const deleted = commits.some(commit => {
        const relative = path.relative(path.join(workspace, commit.repository), absolute).split(path.sep).join('/')
        return git(path.join(workspace, commit.repository), ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '--diff-filter=D', commit.hash, '--', relative]).split('\n').includes(relative)
      })
      if (!deleted) throw new FeatureError(`관련 파일을 찾을 수 없습니다: ${file}`)
    }
    return file
  })
  return { summary, validation, files, commits }
}

export class FeatureStore {
  readonly directory: string
  constructor(directory = path.join(DATA_DIR, 'features')) { this.directory = directory }
  private file(workspace: string) {
    if (!path.isAbsolute(workspace)) throw new FeatureError('프로젝트 경로를 확인하세요')
    return path.join(this.directory, `${crypto.createHash('sha256').update(workspace).digest('hex')}.json`)
  }
  read(workspace: string): FeatureWorkspace {
    const state = this.runtime(workspace)
    if (state?.version === 1) return state
    if (state?.pendingWrites) throw new FeatureError('기능 문서 저장을 복구 중입니다. 잠시 후 다시 시도하세요.', 409)
    const docs = readFeatureDocuments(workspace, featureDocsDir(workspace, state?.docsDir))
    const features = [...docs.values()].map(doc => doc.feature).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    const runs = state?.runs ?? []
    for (const feature of features) if (runs.some(run => activeFeatureRun(run) && run.featureId === feature.id && run.featureVersion === feature.version)) feature.status = 'implementing'
    return { version: 1, workspace, revision: documentVersion(JSON.stringify([state?.revision ?? 0, features])), features, runs }
  }
  private runtime(workspace: string) {
    const data = readJsonFile<RuntimeState | FeatureWorkspace>(this.file(workspace))
    if (data && (![1, 2].includes(data.version) || data.workspace !== workspace || !Number.isInteger(data.revision) || !Array.isArray(data.runs) || data.version === 1 && !Array.isArray(data.features))) throw new FeatureError('기능 실행 기록을 읽을 수 없습니다', 500)
    return data
  }
  runs(workspace: string): FeatureRun[] { return this.runtime(workspace)?.runs ?? [] }
  /** Migrate old ledgers or recover interrupted writes only under the shared writer lock. */
  async prepare(workspace: string) {
    const state = this.runtime(workspace)
    if (state?.version === 1 || state?.version === 2 && state.pendingWrites) await this.change(workspace, () => {})
  }
  workspaces(): string[] {
    if (!fs.existsSync(this.directory)) return []
    return fs.readdirSync(this.directory).filter(file => /^[a-f0-9]{64}\.json$/.test(file)).flatMap(file => {
      const data = readJsonFile<FeatureWorkspace>(path.join(this.directory, file))
      return data && typeof data.workspace === 'string' && path.isAbsolute(data.workspace) ? [data.workspace] : []
    })
  }
  /** Short synchronous transaction under a cross-process lock; no agent/tool work while locked. */
  private async change<T>(workspace: string, fn: (data: FeatureWorkspace) => T, runtimeOnly = false): Promise<T> {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = this.file(workspace), lock = `${file}.lock`, deadline = Date.now() + 5000
    while (true) {
      try {
        const fd = fs.openSync(lock, 'wx', 0o600)
        try { fs.writeFileSync(fd, String(process.pid)) } catch (error) { fs.unlinkSync(lock); throw error } finally { fs.closeSync(fd) }
        break
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        // Serialize stale-lock cleanup too: two processes must not both unlink a
        // dead writer's lock and accidentally remove its live successor's lock.
        const recovery = `${lock}.recovery`
        let recovering = false
        try {
          const fd = fs.openSync(recovery, 'wx', 0o600); recovering = true; fs.closeSync(fd)
          const pid = Number(fs.readFileSync(lock, 'utf8')), stat = fs.statSync(lock)
          if (Number.isInteger(pid) && pid > 0) {
            try { process.kill(pid, 0) } catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ESRCH') fs.unlinkSync(lock) }
          } else if (Date.now() - stat.mtimeMs > 30_000) {
            fs.unlinkSync(lock)
          }
        } catch (cause) { if (!['ENOENT', 'EEXIST'].includes((cause as NodeJS.ErrnoException).code ?? '')) throw cause }
        finally { if (recovering) fs.unlinkSync(recovery) }
        if (Date.now() > deadline) throw new FeatureError('다른 변경을 저장 중입니다. 잠시 후 다시 시도하세요.', 409)
        await new Promise(resolve => setTimeout(resolve, 15))
      }
    }
    try {
      let state = this.runtime(workspace)
      if (state?.version === 2 && state.pendingWrites) {
        applyDocumentWrites(workspace, state.pendingWrites)
        delete state.pendingWrites; writeFileAtomic(file, JSON.stringify(state) + '\n')
      }
      const legacy = state?.version === 1 ? state : null
      const docsDir = featureDocsDir(workspace, state?.version === 2 ? state.docsDir : undefined)
      const docs = runtimeOnly && !legacy ? new Map() : readFeatureDocuments(workspace, docsDir)
      const data: FeatureWorkspace = legacy ? structuredClone(legacy) : runtimeOnly ? { version: 1, workspace, revision: state?.revision ?? 0, features: [], runs: state?.runs ?? [] } : this.read(workspace)
      if (legacy) {
        for (const feature of data.features) {
          if (docs.has(feature.id)) throw new FeatureError(`기존 기능 ${feature.id}와 Markdown ID가 겹칩니다. 원본을 확인하세요.`, 409)
          const reports = data.runs.filter(run => run.featureId === feature.id && run.state === 'completed' && run.report).map(run => run.report!)
          feature.report = reports.reduce<FeatureReport | null>((previous, report) => mergeFeatureReport(previous, report), null)
        }
        data.features.push(...[...docs.values()].map(doc => doc.feature))
      }
      const before = JSON.stringify(data), original = new Map(data.features.map(feature => [feature.id, JSON.stringify(feature)])), result = fn(data)
      if (legacy || JSON.stringify(data) !== before) {
        validateHierarchy(data.features)
        const paths = featureDocumentPaths(workspace, docsDir, data.features, docs)
        const contents = new Map<string, { path: string; content: string }>()
        for (const feature of data.features) {
          const old = docs.get(feature.id), relative = paths.get(feature.id)!
          const changed = !old || original.get(feature.id) !== JSON.stringify(feature) || relative !== old.feature.documentPath
          contents.set(feature.id, { path: relative, content: changed ? serializeFeature(feature, old) : old.raw })
        }
        const writes: DocumentWrite[] = featureTreeWrites(workspace, docsDir, docs, contents)
        for (const feature of data.features) {
          const next = contents.get(feature.id)!, parsed = parseFeatureDocument(next.path, next.content, feature.updatedAt).feature
          parsed.parentId = feature.parentId
          for (const run of data.runs) if (run.featureId === feature.id && run.featureVersion === feature.version) run.featureVersion = parsed.version
          for (const run of data.runs) if (run.targetId === feature.id && run.targetVersion === feature.version) run.targetVersion = parsed.version
          Object.assign(feature, parsed, { status: feature.status })
        }
        if (legacy) {
          try { fs.writeFileSync(`${file}.v1-backup`, JSON.stringify(legacy) + '\n', { flag: 'wx', mode: 0o600 }) }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
          // Requests accepted against the previous numeric versions still refer to the same requirements.
          for (const run of data.runs) {
            const old = legacy.features.find(feature => feature.id === run.targetId)
            if (old && run.targetVersion === old.version) run.targetVersion = data.features.find(feature => feature.id === old.id)!.version
          }
        }
        state = { version: 2, workspace, docsDir, revision: (state?.revision ?? 0) + 1, runs: data.runs, ...(writes.length ? { pendingWrites: writes } : {}) }
        writeFileAtomic(file, JSON.stringify(state) + '\n')
        if (writes.length) { applyDocumentWrites(workspace, writes); delete state.pendingWrites; writeFileAtomic(file, JSON.stringify(state) + '\n') }
      }
      return result
    } finally { fs.unlinkSync(lock) }
  }
  async request(workspace: string, owner: string, input: FeatureRequest, agentSet: FeatureRun['agentSet'], context: FeatureRun['context'] = { projectRoot: workspace, docsRoot: path.join(workspace, featureDocsDir(workspace)) }) {
    if (!uuid.test(input.id)) throw new FeatureError('요청 ID를 확인하세요')
    const title = text(input.title, '제목', 300), content = text(input.content, '내용', 40_000, false)
    const edit = input.edit === undefined ? undefined : (() => {
      const value = record(input.edit)
      if (!input.targetId || input.parentId || !Number.isInteger(input.expectedVersion)) throw new FeatureError('인라인 수정 대상을 확인하세요')
      if (value.parentId !== null && typeof value.parentId !== 'string') throw new FeatureError('상위 기능을 확인하세요')
      const result = { title: text(value.title, '제목', 300), content: text(value.content, '내용', 40_000, false), parentId: value.parentId as string | null, summary: text(value.summary, '구현 내용', 40_000, false), validation: text(value.validation, '검증 내용', 20_000, false) }
      if (title !== result.title || content !== result.content) throw new FeatureError('요청과 수정 명세가 다릅니다')
      return result
    })()
    return this.change(workspace, data => {
      const existing = data.runs.find(run => run.id === input.id)
      if (existing) {
        if (existing.owner !== owner || existing.title !== title || existing.content !== content || existing.agentSet.id !== agentSet.id || existing.targetId !== (input.targetId ?? null) || existing.parentId !== (input.parentId ?? null)) throw new FeatureError('같은 요청 ID에 다른 내용이 있습니다', 409)
        if (JSON.stringify(existing.edit?.after) !== JSON.stringify(edit) || (edit && existing.edit?.version !== input.expectedVersion)) throw new FeatureError('같은 요청 ID에 다른 수정이 있습니다', 409)
        return existing
      }
      if (input.targetId && input.parentId) throw new FeatureError('수정 대상과 상위 기능을 동시에 지정할 수 없습니다')
      if (input.targetId) {
        const target = featureOf(data, input.targetId); checkVersion(target, input.expectedVersion)
        if (data.runs.some(run => run.featureId === target.id && pendingFeatureRun(run) || run.targetId === target.id && pendingFeatureRun(run))) throw new FeatureError('이 기능의 작업이 이미 대기하거나 진행 중입니다', 409)
      }
      if (input.parentId) featureOf(data, input.parentId)
      if (data.runs.filter(pendingFeatureRun).length >= 50) throw new FeatureError('대기 요청은 최대 50개입니다')
      const time = now(), run: FeatureRun = { id: input.id, owner, title, content, targetId: input.targetId ?? null, targetVersion: input.targetId ? input.expectedVersion! : null, parentId: input.parentId ?? null, featureId: null, featureVersion: null, agentSet: { ...agentSet }, context: { ...context }, tabId: `feature_${input.id}`, sessionId: null, dispatchedAt: null, state: 'queued', reason: '', error: '', createdAt: time, updatedAt: time, report: null }
      if (edit) {
        const feature = featureOf(data, input.targetId)
        const before = featureSpecification(feature)
        if (JSON.stringify(before) === JSON.stringify(edit)) throw new FeatureError('변경된 내용이 없습니다')
        if (edit.parentId) featureOf(data, edit.parentId)
        run.edit = { before, after: edit, version: feature.version }
        Object.assign(feature, { title: edit.title, content: edit.content, parentId: edit.parentId, status: 'changed', report: { ...feature.report, summary: edit.summary, validation: edit.validation, files: feature.report?.files ?? [], commits: feature.report?.commits ?? [] } })
        touch(feature)
        run.targetVersion = feature.version
      }
      data.runs.push(run); return run
    })
  }
  async edit(workspace: string, id: string, input: unknown) {
    const value = record(input)
    return this.change(workspace, data => {
      const feature = featureOf(data, id); checkVersion(feature, value.version)
      const title = text(value.title, '제목', 300), content = text(value.content, '내용', 40_000, false)
      const parentId = value.parentId === null ? null : featureOf(data, value.parentId).id
      let ancestor = parentId
      while (ancestor) { if (ancestor === feature.id) throw new FeatureError('자기 자신이나 하위 기능 아래로 옮길 수 없습니다'); ancestor = featureOf(data, ancestor).parentId }
      if (title !== feature.title || content !== feature.content || parentId !== feature.parentId) {
        feature.title = title; feature.content = content; feature.parentId = parentId; feature.status = 'changed'; touch(feature)
      }
      return feature
    })
  }
  async judge(workspace: string, id: string, version: number, status: unknown) {
    if (status !== 'verified' && status !== 'needs-fix') throw new FeatureError('사용자 확인 상태를 선택하세요')
    return this.change(workspace, data => { const feature = featureOf(data, id); checkVersion(feature, version); if (feature.status !== status) { feature.status = status; touch(feature) }; return feature })
  }
  async claim(workspace: string): Promise<FeatureRun | null> {
    return this.change(workspace, data => {
      if (data.runs.some(activeFeatureRun)) return null
      const run = data.runs.find(item => item.state === 'queued')
      if (!run) return null
      run.state = 'starting'; run.updatedAt = now(); return run
    })
  }
  async updateRun(workspace: string, id: string, update: Partial<Pick<FeatureRun, 'sessionId' | 'dispatchedAt' | 'state' | 'error'>>) {
    return this.change(workspace, data => {
      const run = runOf(data, id)
      if (!pendingFeatureRun(run)) return run
      if (run.state === 'cancelling' && update.state !== 'cancelling') delete update.state
      if (update.state && !activeFeatureRun({ ...run, state: update.state })) throw new FeatureError('종료는 완료·중단 경로를 사용하세요')
      Object.assign(run, update); run.updatedAt = now(); return run
    }, true)
  }
  async beginDispatch(workspace: string, id: string) {
    return this.change(workspace, data => {
      const run = runOf(data, id)
      if (!activeFeatureRun(run) || run.state === 'cancelling' || run.dispatchedAt) return false
      run.dispatchedAt = now(); run.updatedAt = run.dispatchedAt
      return true
    })
  }
  async requestCancellation(workspace: string, id: string) {
    return this.change(workspace, data => {
      const run = runOf(data, id)
      if (!pendingFeatureRun(run)) return run
      run.state = run.dispatchedAt ? 'cancelling' : 'cancelled'; run.updatedAt = now()
      return run
    }, true)
  }
  async assign(workspace: string, id: string, input: unknown) {
    const value = record(input)
    return this.change(workspace, data => {
      const run = runOf(data, id)
      if (!activeFeatureRun(run) || run.state === 'cancelling') throw new FeatureError('진행 중인 요청만 분류할 수 있습니다', 409)
      if (run.featureId) return featureOf(data, run.featureId)
      const action = value.action
      if (!['new', 'update', 'child'].includes(String(action))) throw new FeatureError('분류는 new, update, child 중 하나여야 합니다')
      if (run.targetId && (action !== 'update' || value.featureId !== run.targetId)) throw new FeatureError('사용자가 지정한 수정 대상을 유지하세요')
      if (run.parentId && (action !== 'child' || value.parentId !== run.parentId)) throw new FeatureError('사용자가 지정한 상위 기능을 유지하세요')
      const title = text(value.title, '제목', 300), content = text(value.content, '내용', 40_000, false)
      let feature: Feature
      if (action === 'update') {
        feature = featureOf(data, value.featureId); checkVersion(feature, value.version)
        if (run.targetId) checkVersion(feature, run.targetVersion)
        feature.title = title; feature.content = content; feature.status = 'implementing'; touch(feature)
      } else {
        if (data.features.length >= 2000) throw new FeatureError('기능은 최대 2000개입니다')
        const time = now()
        feature = { id: crypto.randomUUID(), parentId: action === 'child' ? featureOf(data, value.parentId).id : null, title, content, status: 'implementing', version: 1, createdAt: time, updatedAt: time }
        data.features.push(feature)
      }
      run.featureId = feature.id; run.featureVersion = feature.version; run.reason = text(value.reason, '분류 이유', 4000); run.state = 'running'; run.updatedAt = now()
      return feature
    })
  }
  async report(workspace: string, id: string, input: unknown) {
    const report = validateFeatureReport(workspace, input)
    return this.change(workspace, data => {
      const run = runOf(data, id)
      if (!activeFeatureRun(run) || run.state === 'cancelling' || !run.featureId) throw new FeatureError('먼저 진행 중인 요청을 기능에 연결하세요', 409)
      run.report = report; run.updatedAt = now(); return run
    })
  }
  async finish(workspace: string, id: string, state: 'completed' | 'failed' | 'cancelled', error = '') {
    return this.change(workspace, data => {
      const run = runOf(data, id)
      if (!pendingFeatureRun(run)) return run
      if (run.state === 'cancelling') state = 'cancelled'
      if (state === 'completed' && !run.report) { state = 'failed'; error = '구현 결과 보고가 없습니다. 대화를 확인하고 다시 요청하세요.' }
      run.state = state; run.error = error.slice(0, 8000); run.updatedAt = now()
      if (run.featureId) {
        const feature = data.features.find(feature => feature.id === run.featureId)
        if (feature && feature.version === run.featureVersion) {
          feature.status = state === 'completed' ? 'implemented' : 'changed'
          if (state === 'completed' && run.report) feature.report = mergeFeatureReport(feature.report, run.report)
          touch(feature)
        }
      }
      return run
    })
  }
}
