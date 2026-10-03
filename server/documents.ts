import { representativeName } from '../shared/document-pages.ts'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT, DOCS_ROOT, resolveProjectPath } from './paths.ts'
import { buildFrontmatter } from './frontmatter.ts'

export class ConflictError extends Error {}

// 폴더에 따라 MOC.md 또는 _MOC.md(정렬을 위해 언더스코어를 붙인 경우)를 쓴다
const MOC_NAMES = ['_MOC.md', 'MOC.md']

/** Walks up from relDir toward DOCS_ROOT looking for the nearest MOC file, falling back to the root one. */
function findNearestMoc(relDir: string): string {
  let dir = relDir
  while (dir && dir !== '.') {
    for (const name of [representativeName(dir), ...MOC_NAMES]) {
      const candidate = path.join(dir, name)
      if (fs.existsSync(path.join(DOCS_ROOT, candidate))) return candidate.split(path.sep).join('/')
    }
    dir = path.dirname(dir)
  }
  return 'MOC.md'
}

function appendMocLink(mocRelPath: string, targetRelPath: string, title: string) {
  const mocAbs = path.join(DOCS_ROOT, mocRelPath)
  const linkPath = path.relative(path.dirname(mocAbs), path.join(DOCS_ROOT, targetRelPath)).split(path.sep).join('/')
  const content = fs.readFileSync(mocAbs, 'utf-8')
  fs.writeFileSync(mocAbs, content.replace(/\s*$/, '') + `\n- [${title}](${linkPath})\n`, 'utf-8')
}

/**
 * 입력한 경로로 새 파일 생성. 마크다운 이외에는 빈 파일을 만든다.
 * 마크다운은 docs에서 SSoT 규칙대로 frontmatter(title은 본문 H1이 아니라 여기)와
 * 가장 가까운 MOC 등록까지, 다른 프로젝트는 H1만 있는 평범한 마크다운으로 만든다.
 */
export function createDocument(project: string, relPath: string, title: string): { relPath: string; mocRelPath: string | null } {
  const abs = resolveProjectPath(project, relPath)
  if (fs.existsSync(abs)) throw new ConflictError(`이미 존재하는 파일입니다: ${relPath}`)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  if (!relPath.toLowerCase().endsWith('.md')) {
    fs.writeFileSync(abs, '', 'utf-8')
    return { relPath, mocRelPath: null }
  }
  if (project !== DEFAULT_PROJECT) {
    fs.writeFileSync(abs, `# ${title}\n`, 'utf-8')
    return { relPath, mocRelPath: null }
  }
  fs.writeFileSync(abs, buildFrontmatter(title), 'utf-8')
  const candidate = findNearestMoc(path.dirname(relPath))
  const mocRelPath = fs.existsSync(path.join(DOCS_ROOT, candidate)) ? candidate : null
  if (mocRelPath) appendMocLink(mocRelPath, relPath, title)
  return { relPath, mocRelPath }
}

/** Creates an empty directory (a no-op in git until it holds a tracked file). */
export function createFolder(project: string, relPath: string): { relPath: string } {
  const abs = resolveProjectPath(project, relPath)
  if (fs.existsSync(abs)) throw new ConflictError(`이미 존재하는 폴더입니다: ${relPath}`)
  fs.mkdirSync(abs, { recursive: true })
  return { relPath }
}

/** Renames/moves a file or directory on disk. */
export function renamePath(project: string, oldRelPath: string, newRelPath: string): void {
  const oldAbs = resolveProjectPath(project, oldRelPath)
  const newAbs = resolveProjectPath(project, newRelPath)
  if (!fs.existsSync(oldAbs)) throw new ConflictError(`존재하지 않는 경로입니다: ${oldRelPath}`)
  if (fs.existsSync(newAbs)) throw new ConflictError(`이미 존재하는 경로입니다: ${newRelPath}`)
  fs.mkdirSync(path.dirname(newAbs), { recursive: true })
  fs.renameSync(oldAbs, newAbs)
}

/** Deletes a file or directory (recursively) from disk. */
export function deletePath(project: string, relPath: string): void {
  fs.rmSync(resolveProjectPath(project, relPath), { recursive: true, force: true })
}

/** 같은 폴더에 "이름 copy.ext"(충돌 시 "이름 copy 2.ext" …)로 파일을 복제하고 새 상대 경로를 돌려준다. */
export function copyFile(project: string, relPath: string): string {
  const abs = resolveProjectPath(project, relPath)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new ConflictError(`존재하지 않는 파일입니다: ${relPath}`)
  }
  const ext = path.extname(relPath)
  const base = path.basename(relPath, ext)
  const parent = path.dirname(relPath)
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? `${base} copy${ext}` : `${base} copy ${i}${ext}`
    const candidateRel = parent === '.' ? name : `${parent}/${name}`
    const candidateAbs = resolveProjectPath(project, candidateRel)
    if (!fs.existsSync(candidateAbs)) {
      fs.copyFileSync(abs, candidateAbs)
      return candidateRel
    }
  }
  throw new ConflictError(`복사본 이름을 만들 수 없습니다: ${relPath}`)
}

/**
 * destDir 안에서 아직 비어 있는 이름을 고른다 — 원래 이름 → "이름 copy" → "이름 copy 2" …
 * destDir=''는 프로젝트 루트.
 */
function availableRelPath(project: string, destDir: string, base: string, ext: string): string {
  const joinDest = (name: string) => (destDir === '' || destDir === '.' ? name : `${destDir}/${name}`)
  for (let i = 0; i < 100; i++) {
    // i=0은 원래 이름 그대로, 이후 " copy" → " copy 2" …(같은 이름이 이미 있을 때)
    const name = i === 0 ? `${base}${ext}` : i === 1 ? `${base} copy${ext}` : `${base} copy ${i}${ext}`
    const candidateRel = joinDest(name)
    if (!fs.existsSync(resolveProjectPath(project, candidateRel))) return candidateRel
  }
  throw new ConflictError(`쓸 수 있는 이름을 만들 수 없습니다: ${base}${ext}`)
}

/**
 * 파일 또는 폴더를 destDir 안으로 복사한다(붙여넣기). 원래 이름을 유지하되,
 * 같은 폴더에 이미 있으면 "이름 copy"(→ "이름 copy 2" …)로 비켜 쓴다. 폴더는 재귀 복사한다.
 * destDir=''는 프로젝트 루트. 새 상대 경로를 돌려준다.
 */
export function copyPathInto(project: string, srcRelPath: string, destDir: string): string {
  const srcAbs = resolveProjectPath(project, srcRelPath)
  if (!fs.existsSync(srcAbs)) throw new ConflictError(`존재하지 않는 경로입니다: ${srcRelPath}`)
  const destDirAbs = resolveProjectPath(project, destDir)
  if (fs.existsSync(destDirAbs) && !fs.statSync(destDirAbs).isDirectory()) {
    throw new ConflictError(`폴더가 아닙니다: ${destDir}`)
  }
  // 폴더를 자기 자신 또는 그 하위로 복사하면 무한 재귀가 된다 — 막는다
  if (srcAbs === destDirAbs || destDirAbs.startsWith(srcAbs + path.sep)) {
    throw new ConflictError('폴더를 자기 자신 안으로는 복사할 수 없습니다')
  }
  const isFile = fs.statSync(srcAbs).isFile()
  const ext = isFile ? path.extname(srcRelPath) : ''
  const base = isFile ? path.basename(srcRelPath, ext) : path.basename(srcRelPath)
  const relPath = availableRelPath(project, destDir, base, ext)
  fs.cpSync(srcAbs, resolveProjectPath(project, relPath), { recursive: true })
  return relPath
}

/**
 * 바깥(파일 탐색기)에서 사이드바로 끌어다 놓은 파일을 destDir 안에 그대로 저장한다.
 * 이름은 원본 그대로 쓰되 같은 이름이 있으면 " copy"로 비켜 쓴다. destDir=''는 프로젝트 루트.
 */
export function writeFileInto(project: string, destDir: string, fileName: string, data: Buffer): string {
  const destDirAbs = resolveProjectPath(project, destDir)
  if (fs.existsSync(destDirAbs) && !fs.statSync(destDirAbs).isDirectory()) {
    throw new ConflictError(`폴더가 아닙니다: ${destDir}`)
  }
  // 파일명은 브라우저가 그대로 실어 보낸 바깥 값이다 — 경로 조각(윈도 역슬래시 포함)을 떼고 이름만 쓴다
  const name = path.basename(fileName.replace(/\\/g, '/')).trim()
  if (!name || name === '.' || name === '..') throw new ConflictError(`올바른 파일 이름이 아닙니다: ${fileName}`)
  const ext = path.extname(name)
  const relPath = availableRelPath(project, destDir, path.basename(name, ext), ext)
  fs.mkdirSync(destDirAbs, { recursive: true })
  fs.writeFileSync(resolveProjectPath(project, relPath), data)
  return relPath
}

/** multer 임시 파일을 프로젝트에 옮긴다. 다른 파일시스템이면 메모리 대신 copy+unlink로 폴백한다. */
export function moveFileInto(project: string, destDir: string, fileName: string, tempPath: string): string {
  const destDirAbs = resolveProjectPath(project, destDir)
  if (fs.existsSync(destDirAbs) && !fs.statSync(destDirAbs).isDirectory()) throw new ConflictError(`폴더가 아닙니다: ${destDir}`)
  const name = path.basename(fileName.replace(/\\/g, '/')).trim()
  if (!name || name === '.' || name === '..') throw new ConflictError(`올바른 파일 이름이 아닙니다: ${fileName}`)
  const ext = path.extname(name)
  const relPath = availableRelPath(project, destDir, path.basename(name, ext), ext)
  const destination = resolveProjectPath(project, relPath)
  fs.mkdirSync(destDirAbs, { recursive: true })
  try {
    fs.renameSync(tempPath, destination)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    fs.copyFileSync(tempPath, destination)
    fs.unlinkSync(tempPath)
  }
  return relPath
}
