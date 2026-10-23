import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { BranchFeature, BranchFeatureDirty, BranchFeaturePatch, BranchFeatureReview, BranchFeatureSnapshot } from '../shared/branch-features.ts'
import { validPreviewPort } from '../shared/port-preview.ts'

const execute = promisify(execFile)
const METADATA_FILE = 'mew-branch-features.json'
const REVIEW_STATES: BranchFeatureReview[] = ['pending', 'verified', 'needs-fix']
interface BranchMetadata {
  title: string
  notes: string
  validation: string
  review: BranchFeatureReview
  previewPort: number | null
  previewPath: string
  updatedAt: string | null
  reviewRevision?: string
}
interface Metadata { version: 1; branches: Record<string, BranchMetadata> }
interface Repository { commonDir: string; currentBranch: string | null }
interface Worktree { path: string; branch: string | null; prunable: boolean }
interface BranchState { dirty: BranchFeatureDirty | null; revision: string }
export class BranchFeatureError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execute('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } })
  return result.stdout
}
async function repository(cwd: string): Promise<Repository | null> {
  try {
    if ((await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() !== 'true') return null
    const commonDir = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).replace(/\r?\n$/, '')
    const currentBranch = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(value => value.trim(), () => null)
    return { commonDir, currentBranch }
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') throw new BranchFeatureError('Git을 실행할 수 없습니다.', 503)
    return null
  }
}
function defaults(): BranchMetadata { return { title: '', notes: '', validation: '', review: 'pending', previewPort: null, previewPath: '/', updatedAt: null } }
function hasControl(value: string, includeSpace = false): boolean { return [...value].some(character => character.charCodeAt(0) <= (includeSpace ? 32 : 31) || character.charCodeAt(0) === 127) }
function validPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || hasControl(value)) return false
  try {
    const pathname = value.split(/[?#]/, 1)[0]!
    const decoded = decodeURIComponent(pathname)
    if (decoded.includes('\\') || hasControl(decoded) || /%(?:2f|5c)/i.test(pathname) || decoded.split('/').some(segment => segment === '.' || segment === '..')) return false
    return new URL(value, 'http://localhost').origin === 'http://localhost'
  } catch { return false }
}
function patch(input: unknown): BranchFeaturePatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BranchFeatureError('브랜치 정보를 입력하세요.')
  const item = input as Record<string, unknown>
  if (typeof item.branch !== 'string' || !item.branch || item.branch.length > 1024 || hasControl(item.branch, true)) throw new BranchFeatureError('올바른 브랜치를 선택하세요.')
  const result: BranchFeaturePatch = { branch: item.branch }
  if ('expectedRevision' in item) {
    if (typeof item.expectedRevision !== 'string' || !/^[a-f0-9]{64}$/.test(item.expectedRevision)) throw new BranchFeatureError('브랜치 버전을 확인하세요.')
    result.expectedRevision = item.expectedRevision
  }
  for (const [key, maximum] of [['title', 200], ['notes', 10_000], ['validation', 10_000]] as const) {
    if (!(key in item)) continue
    if (typeof item[key] !== 'string' || item[key].length > maximum || item[key].includes('\0')) throw new BranchFeatureError(`${key === 'title' ? '제목' : key === 'notes' ? '작업 내용' : '검증 기록'}을 확인하세요.`)
    result[key] = item[key].trim()
  }
  if ('review' in item) {
    if (!REVIEW_STATES.includes(item.review as BranchFeatureReview)) throw new BranchFeatureError('올바른 확인 상태를 선택하세요.')
    result.review = item.review as BranchFeatureReview
  }
  if ('previewPort' in item) {
    if (item.previewPort !== null && !validPreviewPort(item.previewPort)) throw new BranchFeatureError('미리보기 포트는 1~65535 사이의 정수여야 합니다.')
    result.previewPort = item.previewPort
  }
  if ('previewPath' in item) {
    if (!validPath(item.previewPath)) throw new BranchFeatureError('/로 시작하는 미리보기 경로를 입력하세요.')
    result.previewPath = item.previewPath
  }
  return result
}
async function readMetadata(commonDir: string): Promise<Metadata> {
  try {
    const file = path.join(commonDir, METADATA_FILE)
    if ((await fs.stat(file)).size > 8 * 1024 * 1024) throw new Error('metadata-too-large')
    const data: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!data || typeof data !== 'object' || (data as Metadata).version !== 1 || !(data as Metadata).branches || typeof (data as Metadata).branches !== 'object' || Array.isArray((data as Metadata).branches)) throw new Error('invalid-metadata')
    const branches: Record<string, BranchMetadata> = Object.create(null)
    for (const [branch, value] of Object.entries((data as Metadata).branches)) {
      const { branch: _branch, ...validated } = patch({ ...value, branch })
      branches[branch] = { ...defaults(), ...validated, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null, ...(typeof value.reviewRevision === 'string' ? { reviewRevision: value.reviewRevision } : {}) }
    }
    return { version: 1, branches }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, branches: Object.create(null) }
    throw new BranchFeatureError('저장된 브랜치 정보를 읽지 못했습니다.', 500)
  }
}
function worktrees(output: string): Worktree[] {
  const rows: Worktree[] = []
  let item: Worktree | undefined
  for (const entry of output.split('\0')) {
    if (entry.startsWith('worktree ')) { item = { path: entry.slice(9), branch: null, prunable: false }; rows.push(item) }
    else if (item && entry.startsWith('branch refs/heads/')) item.branch = entry.slice(18)
    else if (item && (entry === 'prunable' || entry.startsWith('prunable '))) item.prunable = true
  }
  return rows.filter(item => !item.prunable)
}
async function worktreeState(worktree: string): Promise<BranchState> {
  try {
    const [output, index] = await Promise.all([
      git(worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      git(worktree, ['diff', '--cached', '--raw', '--no-renames', '--abbrev=40', '-z']),
    ])
    const entries = output.split('\0'), dirty = { staged: 0, unstaged: 0, untracked: 0 }, signature: string[] = []
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      if (!entry) continue
      if (entry.startsWith('??')) dirty.untracked++
      else { if (entry[0] !== ' ') dirty.staged++; if (entry[1] !== ' ') dirty.unstaged++ }
      const relative = entry.slice(3)
      const stamp = await fs.lstat(path.join(worktree, relative), { bigint: true }).then(stat => `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`, () => 'missing')
      signature.push(`${entry}:${stamp}`)
      if (entry[0] === 'R' || entry[0] === 'C' || entry[1] === 'R' || entry[1] === 'C') signature.push(entries[++i] ?? '')
    }
    return { dirty, revision: crypto.createHash('sha256').update(index).update(signature.join('\0')).digest('hex') }
  } catch { return { dirty: null, revision: 'unavailable' } }
}
async function listening(port: number): Promise<boolean> {
  const connect = (host: string) => new Promise<boolean>(resolve => {
    const socket = net.createConnection({ host, port })
    let settled = false
    const finish = (open: boolean) => { if (settled) return; settled = true; socket.destroy(); resolve(open) }
    socket.setTimeout(250, () => finish(false))
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false))
  })
  const results = await Promise.all([connect('127.0.0.1'), connect('::1')])
  return results.some(Boolean)
}
function revision(feature: BranchFeature, states: Map<string, BranchState>): string {
  return crypto.createHash('sha256').update(`${feature.commit?.hash ?? ''}:${feature.worktreePaths.map(worktree => `${worktree}:${states.get(worktree)?.revision ?? 'unavailable'}`).join('|')}`).digest('hex')
}
async function inventory(cwd: string, repo: Repository, metadata: Metadata, probePorts = false): Promise<{ branches: BranchFeature[]; baseBranch: string | null; states: Map<string, BranchState> }> {
  const [refs, checkoutList, originHead] = await Promise.all([
    git(cwd, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(subject)%00%(committerdate:iso-strict)', 'refs/heads/']),
    git(cwd, ['worktree', 'list', '--porcelain', '-z']),
    git(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).then(value => value.trim().replace(/^origin\//, ''), () => null),
  ])
  const checkouts = worktrees(checkoutList)
  const stateEntries = await Promise.all(checkouts.filter(item => item.branch).map(async item => [item.path, await worktreeState(item.path)] as const))
  const states = new Map(stateEntries)
  const branches: BranchFeature[] = refs.split('\n').filter(Boolean).map(line => {
    const [ref, hash, subject, committedAt] = line.split('\0')
    const branch = ref!.slice('refs/heads/'.length)
    const saved = Object.hasOwn(metadata.branches, branch!) ? metadata.branches[branch!]! : defaults()
    const worktreePaths = checkouts.filter(item => item.branch === branch).map(item => item.path)
    const worktreePath = worktreePaths.find(item => path.resolve(item) === path.resolve(cwd)) ?? worktreePaths[0] ?? null
    return { branch, revision: '', ...saved, title: saved.title || branch.replace(/^(?:feat|feature)\//, ''), previewStatus: saved.previewPort === null ? 'unconfigured' : 'stopped', current: branch === repo.currentBranch, isBase: false, worktreePath, worktreePaths, dirty: worktreePath ? states.get(worktreePath)?.dirty ?? null : null, commit: { hash: hash!, subject: subject!, committedAt: committedAt! } }
  })
  const names = branches.map(item => item.branch)
  const localBases = ['main', 'master'].filter(name => names.includes(name))
  const baseBranch = originHead && names.includes(originHead) ? originHead : localBases.length === 1 ? localBases[0]! : null
  const ports = probePorts ? [...new Set(branches.flatMap(item => item.previewPort === null ? [] : [item.previewPort]))] : []
  const livePorts = new Map(await Promise.all(ports.map(async port => [port, await listening(port)] as const)))
  for (const item of branches) {
    item.isBase = item.branch === baseBranch || ['main', 'master', 'develop'].includes(item.branch)
    item.previewStatus = item.previewPort === null ? 'unconfigured' : !probePorts ? 'unknown' : livePorts.get(item.previewPort) ? 'running' : 'stopped'
    item.revision = revision(item, states)
    const saved = metadata.branches[item.branch]
    if (saved?.reviewRevision && saved.reviewRevision !== item.revision) item.review = 'pending'
    // Internal version stamps never leave the server.
    delete (item as BranchFeature & { reviewRevision?: string }).reviewRevision
  }
  return { branches, baseBranch, states }
}
async function withMetadataLock<T>(commonDir: string, action: () => Promise<T>): Promise<T> {
  const lockPath = path.join(commonDir, `${METADATA_FILE}.lock`)
  let handle: fs.FileHandle | undefined
  for (let attempt = 0; attempt < 100; attempt++) {
    try { handle = await fs.open(lockPath, 'wx', 0o600); await handle.writeFile(String(process.pid)); break } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const stat = await fs.stat(lockPath).catch(() => null)
      if (stat && Date.now() - stat.mtimeMs > 30_000) {
        const pid = Number(await fs.readFile(lockPath, 'utf8').catch(() => '0'))
        let alive = Number.isInteger(pid) && pid > 0
        if (alive) { try { process.kill(pid, 0) } catch (cause) { alive = (cause as NodeJS.ErrnoException).code !== 'ESRCH' } }
        if (!alive) await fs.unlink(lockPath).catch(() => {})
      }
      await delay(25)
    }
  }
  if (!handle) throw new BranchFeatureError('다른 브랜치 정보를 저장 중입니다. 다시 시도하세요.', 409)
  try { return await action() } finally { await handle.close(); await fs.unlink(lockPath).catch(() => {}) }
}
export async function readBranchFeatures(cwd: string, permissions = { canEdit: false, canPreview: false }): Promise<BranchFeatureSnapshot> {
  const repo = await repository(cwd)
  const empty = { workspace: cwd, isGitRepository: !!repo, baseBranch: null, currentBranch: repo?.currentBranch ?? null, branches: [], ...permissions }
  if (!repo) return empty
  const { branches, baseBranch } = await inventory(cwd, repo, await readMetadata(repo.commonDir), permissions.canPreview)
  return { ...empty, baseBranch, branches }
}
export async function updateBranchFeature(cwd: string, input: unknown): Promise<void> {
  const validated = patch(input), repo = await repository(cwd)
  if (!repo) throw new BranchFeatureError('Git 저장소에서만 브랜치 정보를 저장할 수 있습니다.', 409)
  await withMetadataLock(repo.commonDir, async () => {
    const metadata = await readMetadata(repo.commonDir)
    const { branches, states } = await inventory(cwd, repo, metadata)
    const feature = branches.find(item => item.branch === validated.branch)
    if (!feature) throw new BranchFeatureError('브랜치가 삭제되었거나 더 이상 존재하지 않습니다.', 409)
    if (validated.expectedRevision !== undefined && validated.expectedRevision !== feature.revision) throw new BranchFeatureError('브랜치가 변경되었습니다. 최신 작업을 확인한 뒤 다시 저장하세요.', 409)
    const { branch, expectedRevision: _expectedRevision, ...changes } = validated
    const previous = Object.hasOwn(metadata.branches, branch) ? metadata.branches[branch]! : defaults()
    metadata.branches[branch] = { ...previous, ...changes, updatedAt: new Date().toISOString() }
    if (validated.review !== undefined) metadata.branches[branch]!.reviewRevision = revision(feature, states)
    const file = path.join(repo.commonDir, METADATA_FILE), temporary = `${file}.${crypto.randomUUID()}.tmp`
    try { await fs.writeFile(temporary, JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, file) }
    finally { await fs.unlink(temporary).catch(() => {}) }
  })
}
