import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import simpleGit, { type SimpleGit } from 'simple-git'
import { resolveExistingPath } from './fsBrowse.ts'
import { resolveProjectPath, WORKSPACE_ROOT } from './paths.ts'
import { invalidateGit } from './git.ts'
import { commitFiles } from './git-commit-files.ts'

export class GitWorkbenchError extends Error {}

export interface GitRepositoryInfo {
  workspace: string
  repository: boolean
  path: string
  branch: string | null
  detached: boolean
  dirty: boolean
  ahead: number
  behind: number
  remotes: string[]
}

export interface GitLogEntry {
  hash: string
  parents: string[]
  refs: string[]
  subject: string
  author: string
  email: string
  date: string
}

export interface GitChangedFile {
  status: string
  path: string
  previousPath?: string
}

export interface GitCommitDetail extends GitLogEntry {
  body: string
  files: GitChangedFile[]
}

export interface GitWorkingTreeDetail {
  files: GitChangedFile[]
}

export interface GitWorkingTreeCommitResult {
  info: GitRepositoryInfo
  hash: string
}

export interface GitRepositoryEntry {
  path: string
}

const execFileAsync = promisify(execFile)
const MAX_PATCH_CHARS = 2_000_000

function isRepositoryRoot(abs: string): boolean {
  return fs.existsSync(path.join(abs, '.git'))
}

function scopedDirectory(project: string, relPath: string): string {
  const abs = resolveProjectPath(project, relPath)
  let stat: fs.Stats
  try { stat = fs.statSync(abs) } catch { throw new GitWorkbenchError(`폴더를 찾을 수 없습니다: ${relPath || '.'}`) }
  if (!stat.isDirectory()) throw new GitWorkbenchError(`폴더가 아닙니다: ${relPath || '.'}`)
  return abs
}

function repository(project: string, relPath: string): { abs: string; git: SimpleGit } {
  const abs = scopedDirectory(project, relPath)
  if (!isRepositoryRoot(abs)) throw new GitWorkbenchError(`Git 저장소가 아닙니다: ${relPath || '.'}`)
  return { abs, git: simpleGit({ baseDir: abs, config: ['core.quotepath=false'] }) }
}

/** Only the requested project root; nested projects open in their own project tabs. */
export async function listRepositories(project: string): Promise<GitRepositoryEntry[]> {
  const root = scopedDirectory(project, '')
  return isRepositoryRoot(root) ? [{ path: '' }] : []
}

function assertHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{7,64}$/i.test(value)) throw new GitWorkbenchError('커밋 해시가 올바르지 않습니다')
  return value
}

function assertRefName(value: unknown, kind: 'branch' | 'tag'): string {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('-') || /[~^:?*[\\\s]/.test(value) || value.includes('..') || value.endsWith('.') || value.endsWith('/')) {
    throw new GitWorkbenchError(`${kind === 'branch' ? '브랜치' : '태그'} 이름이 올바르지 않습니다`)
  }
  return value.trim()
}

function parseRecord(record: string): GitLogEntry | null {
  const fields = record.replace(/^\n+/, '').split('\x1f')
  if (fields.length < 7 || !fields[0]) return null
  return {
    hash: fields[0],
    parents: fields[1] ? fields[1].split(' ').filter(Boolean) : [],
    refs: fields[2] ? fields[2].split(',').map((item) => item.trim()).filter(Boolean) : [],
    subject: fields[3],
    author: fields[4],
    email: fields[5],
    date: fields[6].trim(),
  }
}

export async function repositoryInfo(project: string, relPath: string): Promise<GitRepositoryInfo> {
  const workspace = WORKSPACE_ROOT
  const abs = scopedDirectory(project, relPath)
  if (!isRepositoryRoot(abs)) return { workspace, repository: false, path: relPath, branch: null, detached: false, dirty: false, ahead: 0, behind: 0, remotes: [] }
  const git = simpleGit({ baseDir: abs, config: ['core.quotepath=false'] })
  const status = await git.status(['--untracked-files=all'])
  const remotes = await git.getRemotes(true)
  return {
    workspace,
    repository: true,
    path: relPath,
    branch: status.current,
    detached: status.detached,
    dirty: !status.isClean(),
    ahead: status.ahead,
    behind: status.behind,
    remotes: remotes.map((remote) => remote.name),
  }
}

export async function initializeRepository(project: string, relPath: string): Promise<GitRepositoryInfo> {
  const abs = scopedDirectory(project, relPath)
  if (isRepositoryRoot(abs)) throw new GitWorkbenchError(`이미 Git 저장소입니다: ${relPath || '.'}`)
  await simpleGit({ baseDir: abs }).init()
  invalidateGit(project)
  return repositoryInfo(project, relPath)
}

export async function initializeExternalRepository(input: unknown): Promise<string> {
  const abs = resolveExistingPath(input)
  if (!fs.statSync(abs).isDirectory()) throw new GitWorkbenchError(`폴더가 아닙니다: ${abs}`)
  if (isRepositoryRoot(abs)) throw new GitWorkbenchError(`이미 Git 저장소입니다: ${abs}`)
  await simpleGit({ baseDir: abs }).init()
  return abs
}

function cloneName(url: string): string {
  const clean = url.replace(/[\\/]+$/, '')
  const raw = clean.slice(Math.max(clean.lastIndexOf('/'), clean.lastIndexOf(':')) + 1).replace(/\.git$/i, '')
  if (!raw || raw === '.' || raw === '..') throw new GitWorkbenchError('저장소 폴더 이름을 정할 수 없습니다')
  return raw
}

export async function cloneExternalRepository(parentInput: unknown, urlInput: unknown, nameInput?: unknown): Promise<string> {
  const parent = resolveExistingPath(parentInput)
  if (!fs.statSync(parent).isDirectory()) throw new GitWorkbenchError(`폴더가 아닙니다: ${parent}`)
  if (typeof urlInput !== 'string' || !urlInput.trim() || urlInput.trim().startsWith('-')) throw new GitWorkbenchError('Git 저장소 주소가 올바르지 않습니다')
  const url = urlInput.trim()
  const name = nameInput === undefined || nameInput === null || nameInput === '' ? cloneName(url) : assertRefName(nameInput, 'branch')
  if (name.includes('/')) throw new GitWorkbenchError('clone 폴더 이름에는 /를 쓸 수 없습니다')
  const target = path.join(parent, name)
  if (fs.existsSync(target)) throw new GitWorkbenchError(`이미 존재하는 경로입니다: ${target}`)
  await simpleGit({ baseDir: parent }).clone(url, target, ['--'])
  return target
}

export async function repositoryLog(project: string, relPath: string, limit = 300): Promise<GitLogEntry[]> {
  const { git } = repository(project, relPath)
  const count = Math.max(1, Math.min(1000, Math.floor(limit)))
  let raw: string
  try {
    raw = await git.raw(['log', '--all', '--topo-order', `--max-count=${count}`, '--date=iso-strict', '--pretty=format:%x1e%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%ae%x1f%aI'])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/does not have any commits|unknown revision|bad default revision/i.test(message)) return []
    throw err
  }
  return raw.split('\x1e').map(parseRecord).filter((entry): entry is GitLogEntry => entry !== null)
}

export async function commitDetail(project: string, relPath: string, hashInput: unknown): Promise<GitCommitDetail> {
  const { git } = repository(project, relPath)
  const hash = assertHash(hashInput)
  const raw = await git.raw(['show', '-s', '--date=iso-strict', '--format=%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%b', hash])
  const fields = raw.trimEnd().split('\x1f')
  const filesRaw = await git.raw(['diff-tree', '--root', '--no-commit-id', '--name-status', '--no-renames', '-r', '-z', hash])
  const chunks = filesRaw.split('\0').filter(Boolean)
  const files: GitChangedFile[] = []
  for (let index = 0; index + 1 < chunks.length; index += 2) files.push({ status: chunks[index], path: chunks[index + 1] })
  return {
    hash: fields[0],
    parents: fields[1] ? fields[1].split(' ').filter(Boolean) : [],
    refs: fields[2] ? fields[2].split(',').map((item) => item.trim()).filter(Boolean) : [],
    subject: fields[3] ?? '',
    author: fields[4] ?? '',
    email: fields[5] ?? '',
    date: fields[6] ?? '',
    body: fields.slice(7).join('\x1f').trim(),
    files,
  }
}

function literalPathspec(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new GitWorkbenchError('파일 경로가 올바르지 않습니다')
  }
  return `:(literal)${value}`
}

function limitedPatch(diff: string): string {
  return diff.length <= MAX_PATCH_CHARS ? diff : `${diff.slice(0, MAX_PATCH_CHARS)}\n\n… patch가 2MB를 넘어 나머지를 생략했습니다 …\n`
}

export async function workingTreeDetail(project: string, relPath: string): Promise<GitWorkingTreeDetail> {
  const { git } = repository(project, relPath)
  const status = await git.status(['--untracked-files=all'])
  return {
    files: status.files.map((file) => ({
      status: `${file.index}${file.working_dir}`,
      path: file.path,
      ...(file.from ? { previousPath: file.from } : {}),
    })),
  }
}

async function untrackedFileDiff(abs: string, file: string): Promise<string> {
  try {
    const result = await execFileAsync('git', ['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', `./${file}`], {
      cwd: abs,
      encoding: 'utf8',
      maxBuffer: MAX_PATCH_CHARS * 2,
    })
    return result.stdout
  } catch (err) {
    // git diff --no-index는 차이가 있으면 정상적으로 1을 반환한다.
    const result = err as { code?: number; stdout?: string }
    if (result.code === 1 && typeof result.stdout === 'string') return result.stdout
    throw err
  }
}

export async function workingTreeFileDiff(project: string, relPath: string, fileInput: unknown): Promise<string> {
  const { abs, git } = repository(project, relPath)
  const pathspec = literalPathspec(fileInput)
  const file = String(fileInput)
  const status = await git.status(['--untracked-files=all'])
  const entry = status.files.find((candidate) => candidate.path === file)
  if (!entry) throw new GitWorkbenchError('커밋되지 않은 변경 파일이 아닙니다')
  if (entry.index === '?' && entry.working_dir === '?') {
    return limitedPatch((await untrackedFileDiff(abs, file)).replaceAll('b/./', 'b/'))
  }
  let hasHead = true
  try { await git.raw(['rev-parse', '--verify', 'HEAD']) } catch { hasHead = false }
  const diff = hasHead
    ? await git.raw(['diff', '--no-ext-diff', '--unified=3', 'HEAD', '--', pathspec])
    : await git.raw(['diff', '--cached', '--no-ext-diff', '--unified=3', '--', pathspec])
  return limitedPatch(diff)
}

function commitMessagePart(value: unknown, label: string, maxLength: number, required: boolean): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new GitWorkbenchError(`${label}이 올바르지 않습니다`)
  const result = value.trim()
  if (required && !result) throw new GitWorkbenchError(`${label}을 입력하세요`)
  if (result.length > maxLength) throw new GitWorkbenchError(`${label}은 ${maxLength.toLocaleString()}자 이하여야 합니다`)
  return result
}

export async function commitWorkingTree(project: string, relPath: string, titleInput: unknown, descriptionInput?: unknown, filesInput?: unknown): Promise<GitWorkingTreeCommitResult> {
  const { abs } = repository(project, relPath)
  const title = commitMessagePart(titleInput, '커밋 제목', 500, true)
  const description = commitMessagePart(descriptionInput ?? '', '커밋 설명', 20_000, false)
  let hash: string
  try { hash = await commitFiles(abs, title, description, filesInput) }
  catch (error) { throw new GitWorkbenchError((error as Error).message) }
  invalidateGit(project)
  return { info: await repositoryInfo(project, relPath), hash }
}

export async function commitFileDiff(project: string, relPath: string, hashInput: unknown, fileInput: unknown): Promise<string> {
  const { git } = repository(project, relPath)
  const diff = await git.raw(['show', '--format=', '--no-ext-diff', '--unified=3', assertHash(hashInput), '--', literalPathspec(fileInput)])
  return limitedPatch(diff)
}

export type GitCommitAction = 'branch' | 'tag' | 'checkout' | 'cherry-pick' | 'revert'

const remoteOperations = new Set<string>()

export async function runRemoteAction(project: string, relPath: string, action: unknown): Promise<void> {
  if (action !== 'pull' && action !== 'push') throw new GitWorkbenchError('지원하지 않는 Git 작업입니다')
  const { abs, git } = repository(project, relPath)
  const key = fs.realpathSync(abs)
  if (remoteOperations.has(key)) throw new GitWorkbenchError('Git 원격 작업이 이미 실행 중입니다')
  remoteOperations.add(key)
  try {
    const status = await git.status()
    if (status.detached || !status.current) throw new GitWorkbenchError('브랜치로 전환한 뒤 다시 시도하세요')
    const remote = (await git.getConfig(`branch.${status.current}.remote`)).value
    const ref = (await git.getConfig(`branch.${status.current}.merge`)).value
    if (!remote || !ref?.startsWith('refs/heads/') || !(await git.getRemotes()).some(item => item.name === remote)) {
      throw new GitWorkbenchError('현재 브랜치의 원격 추적 브랜치(upstream)를 설정한 뒤 다시 시도하세요')
    }
    const args = action === 'pull'
      ? ['pull', '--ff-only', '--no-rebase', '--no-autostash', '--', remote, ref]
      : ['push', '--no-force', '--no-follow-tags', '--recurse-submodules=no', '--', remote, `HEAD:${ref}`]
    await execFileAsync('git', args, { cwd: abs, encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } })
  } finally {
    remoteOperations.delete(key)
    invalidateGit(project)
  }
}

export async function runCommitAction(project: string, relPath: string, action: unknown, hashInput: unknown, nameInput?: unknown): Promise<GitRepositoryInfo> {
  const { git } = repository(project, relPath)
  const hash = assertHash(hashInput)
  switch (action as GitCommitAction) {
    case 'branch': await git.raw(['branch', assertRefName(nameInput, 'branch'), hash]); break
    case 'tag': await git.raw(['tag', assertRefName(nameInput, 'tag'), hash]); break
    case 'checkout': await git.raw(['checkout', '--detach', hash]); break
    case 'cherry-pick': await git.raw(['cherry-pick', hash]); break
    case 'revert': await git.raw(['revert', '--no-edit', hash]); break
    default: throw new GitWorkbenchError('지원하지 않는 Git 작업입니다')
  }
  return repositoryInfo(project, relPath)
}
