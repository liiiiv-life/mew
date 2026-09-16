import fs from 'node:fs'
import path from 'node:path'
import simpleGit, { type SimpleGit } from 'simple-git'
import { DEFAULT_PROJECT, projectRoot } from './paths.ts'

// 프로젝트마다 자기 레포에서 커밋한다 — git 레포가 아닌 폴더는 커밋 없이 저장만 된다
const gitByProject = new Map<string, SimpleGit | null>()

/** Git init 직후에는 이전의 "비레포" 캐시를 버려 다음 저장부터 커밋 경로를 다시 잡는다. */
export function invalidateGit(project: string): void {
  gitByProject.delete(project)
}

function gitFor(project: string): SimpleGit | null {
  let git = gitByProject.get(project)
  if (git === undefined) {
    const root = projectRoot(project)
    // core.quotepath=false — 기본값이면 git이 한글 등 비ASCII 경로를 8진수 이스케이프로 출력해
    // check-ignore·status 결과가 우리가 든 경로 문자열과 안 맞는다(한글 파일명만 커밋이 깨지는 원인)
    git = fs.existsSync(path.join(root, '.git'))
      ? simpleGit({ baseDir: root, config: ['core.quotepath=false'] })
      : null
    gitByProject.set(project, git)
  }
  return git
}

export interface CommitResult {
  message: string
  files: string[]
  hash: string | null
}

/** 마지막 커밋(HEAD) 시점의 파일 내용 — 없으면(새 파일·비레포 등) null */
export async function showHeadContent(project: string, relPath: string): Promise<string | null> {
  const git = gitFor(project)
  if (!git) return null
  try {
    return await git.show([`HEAD:${relPath}`])
  } catch {
    return null
  }
}

/** 특정 커밋 시점의 파일 내용 — 없으면(그 커밋에 파일이 없음·비레포 등) null */
export async function showAtCommit(project: string, relPath: string, hash: string): Promise<string | null> {
  const git = gitFor(project)
  if (!git) return null
  try {
    return await git.show([`${hash}:${relPath}`])
  } catch {
    return null
  }
}

export interface FileHistoryEntry {
  hash: string
  date: string
  message: string
}

/** 특정 파일의 커밋 이력(최신순, 제목 한 줄만) — git 레포가 아니거나 커밋이 없으면 빈 배열 */
export async function fileHistory(project: string, relPath: string): Promise<FileHistoryEntry[]> {
  const git = gitFor(project)
  if (!git) return []
  try {
    const log = await git.log({ file: relPath })
    return log.all.map((entry) => ({ hash: entry.hash, date: entry.date, message: entry.message }))
  } catch {
    return []
  }
}

/** Stages relPath(s) plus (docs only) any changed MOC.md files and commits them together. Returns null if nothing changed. */
export async function commitFile(
  project: string,
  relPaths: string | string[],
  action: 'add' | 'update' | 'delete' | 'rename',
  message?: string,
): Promise<CommitResult | null> {
  const git = gitFor(project)
  if (!git) return null

  const paths = Array.isArray(relPaths) ? relPaths : [relPaths]
  const filesToStage = new Set<string>(paths)
  if (project === DEFAULT_PROJECT) {
    const status = await git.status()
    for (const f of [...status.modified, ...status.not_added, ...status.created, ...status.deleted]) {
      if (/^_?MOC\.md$/.test(path.basename(f))) filesToStage.add(f)
    }
  }

  // .gitignore에 걸린 경로는 스테이징에서 뺀다 — 그대로 add하면 git이 통째로 거부해, 이미
  // 디스크에 반영된 파일 작업이 500으로 둔갑한다(새 파일은 생겼는데 UI는 실패·재시도 "이미 존재"
  // 루프). 이력에서 빠질 뿐 작업 자체는 성공이다. check-ignore는 걸린 게 없으면 exit 1이라
  // catch로 빈 목록 처리한다.
  const ignored = await git.checkIgnore([...filesToStage]).catch(() => [] as string[])
  for (const f of ignored) filesToStage.delete(f)

  // 아직 Git에 추가하지 않은 파일을 옮기면 원래 경로는 디스크와 index 양쪽에 없다.
  // 이를 add하면 실제 이동 뒤에 pathspec 오류가 난다. 추적 중인 삭제 경로는 남겨
  // 삭제/이동 이력을 기록하고, 양쪽에 없는 경로만 제외한다(폴더의 추적 파일도 포함).
  for (const f of filesToStage) {
    if (fs.lstatSync(path.join(projectRoot(project), f), { throwIfNoEntry: false })) continue
    const tracked = await git.raw(['ls-files', '-z', '--', `:(literal)${f}`])
    if (!tracked) filesToStage.delete(f)
  }
  if (filesToStage.size === 0) return null

  await git.add([...filesToStage])
  const staged = await git.diff(['--cached', '--name-only'])
  if (!staged.trim()) return null

  const msg = message ?? `${project}: ${action} ${paths.join(', ')}`
  const result = await git.commit(msg)
  return { message: msg, files: [...filesToStage], hash: result.commit || null }
}
