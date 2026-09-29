import { currentGitEnv } from './git-execution.ts'
import { gitIdentityEnv, type GitIdentity } from './git-connections.ts'
import simpleGit from 'simple-git'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { selectedGitFiles } from './git-selected-files.ts'

/** Commit explicit working-tree paths while retaining every unrelated index entry. */
export async function commitFiles(cwd: string, title: string, description: string, filesInput: unknown): Promise<string> {
  const git = simpleGit(cwd).env(currentGitEnv())
  const status = await git.status(['--untracked-files=all'])
  if (status.isClean()) throw new Error('커밋할 변경사항이 없습니다')
  if (status.conflicted.length) throw new Error('충돌을 해결한 뒤 커밋하세요')
  const selected = selectedGitFiles(status.files, filesInput)
  const paths = [...new Set(selected.flatMap(file => file.from ? [file.from, file.path] : [file.path]))].map(file => `:(literal)${file}`)
  const newPaths = selected.filter(file => file.index === '?').map(file => `:(literal)${file.path}`)
  if (newPaths.length) await git.add(['--', ...newPaths])
  const result = await git.commit(description ? [title, description] : title, paths, { '--only': null })
  if (!result.commit) throw new Error('커밋 해시를 확인할 수 없습니다')
  return (await git.revparse(result.commit)).trim()
}

/** AI commits use the analyzed tree, so an edit racing the commit stays uncommitted. */
export async function commitSnapshotFiles(cwd: string, group: { title: string; description: string; files: string[] }, snapshot: { head: string; branch: string; tree: string; index: string; paths: string[] }, recorded: (hash: string) => void, identity?: GitIdentity): Promise<string> {
  const git = simpleGit(cwd)
  const selected = selectedGitFiles((await git.status(['--untracked-files=all'])).files, group.files)
  const paths = [...new Set(selected.flatMap(file => file.from ? [file.from, file.path] : [file.path]))].map(file => `:(literal)${file}`)
  const index = path.resolve(cwd, (await git.raw(['rev-parse', '--git-path', 'index'])).trim())
  const lock = `${index}.lock`
  const fd = fs.openSync(lock, 'wx', 0o600)
  fs.closeSync(fd)
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-commit-index-'))
  const env = gitIdentityEnv(identity)
  delete env.GIT_PAGER
  delete env.PAGER
  try {
    const currentHead = await git.revparse(['--verify', 'HEAD']).then(value => value.trim(), () => '')
    const branch = await git.raw(['symbolic-ref', '-q', 'HEAD']).then(value => value.trim(), () => '')
    if (currentHead !== snapshot.head || branch !== snapshot.branch || await git.raw(['ls-files', '--stage', '-z', '--', ...snapshot.paths]) !== snapshot.index) throw new Error('커밋 직전에 HEAD 또는 stage가 달라졌습니다')
    const preserved = simpleGit(cwd).env({ ...env, GIT_INDEX_FILE: lock })
    if (fs.existsSync(index)) fs.copyFileSync(index, lock)
    else {
      const empty = simpleGit(cwd).env({ ...env, GIT_INDEX_FILE: path.join(temporary, 'empty') })
      await empty.raw(['read-tree', '--empty'])
      fs.copyFileSync(path.join(temporary, 'empty'), lock)
    }
    const isolated = simpleGit(cwd).env({ ...env, GIT_INDEX_FILE: path.join(temporary, 'index') })
    await isolated.raw(['read-tree', ...(snapshot.head ? [snapshot.head] : ['--empty'])])
    await isolated.raw(['restore', '--source', snapshot.tree, '--staged', '--', ...paths])
    const result = await isolated.commit(group.description ? [group.title, group.description] : group.title)
    if (!result.commit) throw new Error('커밋 해시를 확인할 수 없습니다')
    const hash = (await git.revparse(result.commit)).trim()
    recorded(hash)
    await preserved.raw(['reset', '-q', hash, '--', ...paths])
    fs.renameSync(lock, index)
    return hash
  } finally {
    fs.rmSync(lock, { force: true })
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}
