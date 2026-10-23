// docs 특별 레포를 통째로 옮기는 두 동작 — 가져오기(외부 폴더로 덮어쓰기)와 내보내기(밖으로 복사).
// docs는 프로젝트가 아니라 워크스페이스 하나에 하나뿐인 폴더라(paths.ts) 파일 단위 API가 아니라 폴더 단위로 다룬다.
import fs from 'node:fs'
import path from 'node:path'
import { ensureDocsRoot, workspacePaths } from './paths.ts'

export class DocsRepoError extends Error {}

/** a가 b를 품고 있는지 — 같은 경로도 품는 것으로 친다 */
function contains(a: string, b: string): boolean {
  return b === a || b.startsWith(a + path.sep)
}

function assertDir(abs: string, what: string): void {
  let stat: fs.Stats
  try {
    stat = fs.statSync(abs)
  } catch {
    throw new DocsRepoError(`${what}이(가) 없습니다: ${abs}`)
  }
  if (!stat.isDirectory()) throw new DocsRepoError(`${what}이(가) 폴더가 아닙니다: ${abs}`)
}

/**
 * 외부 폴더의 내용으로 docs를 통째로 바꾼다 — **기존 docs 내용은 전부 지워진다**.
 * 호출 전에 사용자 확인을 받는다(클라이언트 경고창).
 */
export function importDocs(from: string, docsRoot = workspacePaths.docsRoot): void {
  const src = path.resolve(from)
  assertDir(src, '가져올 폴더')
  // 자기 자신이나 서로를 품는 폴더를 넣으면 지우는 순간 원본도 같이 날아간다
  if (contains(src, docsRoot) || contains(docsRoot, src)) {
    throw new DocsRepoError('docs 폴더 자신이나 그 위·아래 폴더는 가져올 수 없습니다')
  }
  fs.rmSync(docsRoot, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(docsRoot), { recursive: true })
  fs.cpSync(src, docsRoot, { recursive: true })
}

/** docs 폴더를 대상 폴더 아래 `docs`로 그대로 복사한다. 이미 있으면 거부 — 덮어쓰지 않는다. */
export function exportDocs(to: string, docsRoot = workspacePaths.docsRoot): string {
  const dir = path.resolve(to)
  assertDir(dir, '내보낼 위치')
  const dest = path.join(dir, 'docs')
  if (contains(docsRoot, dest)) throw new DocsRepoError('docs 폴더 안으로는 내보낼 수 없습니다')
  if (fs.existsSync(dest)) throw new DocsRepoError(`이미 있는 폴더입니다: ${dest}`)
  fs.cpSync(docsRoot === workspacePaths.docsRoot ? ensureDocsRoot() : docsRoot, dest, { recursive: true })
  return dest
}
