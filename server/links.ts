import fs from 'node:fs'
import path from 'node:path'
import { DOCS_ROOT } from './paths.ts'
import { readIgnoreSet } from './ignoreList.ts'

function walkMdFiles(absDir: string, ignore: Set<string>, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue
    const abs = path.join(absDir, entry.name)
    if (entry.isDirectory()) walkMdFiles(abs, ignore, acc)
    else if (entry.isFile() && entry.name.endsWith('.md')) acc.push(abs)
  }
  return acc
}

// 인라인 링크 [label](href) — 이미지 ![alt](...)와 이스케이프 \[는 제외.
// lookbehind를 써야 [a](x)[b](y)처럼 붙어 있는 링크도 놓치지 않는다 (앞 문자를 소비하면 두 번째를 건너뜀)
const LINK_RE = /(?<![!\\])\[([^\]\n]*)\]\(([^)\s]+)\)/g

function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')
}

/**
 * targetRel 문서의 title이 바뀌었을 때, 그 문서를 가리키는 모든 내부 링크의 라벨을
 * 새 title로 맞춘다 ("내부 링크 텍스트 = 대상 문서 title" 정책). 바뀐 파일 목록을 반환.
 */
export function updateLinkLabelsFor(targetRel: string, newTitle: string, mayEdit: (path: string) => boolean = () => true): string[] {
  const changed: string[] = []
  for (const abs of walkMdFiles(DOCS_ROOT, readIgnoreSet())) {
    const rel = path.relative(DOCS_ROOT, abs).split(path.sep).join('/')
    if (rel === targetRel || !mayEdit(rel)) continue
    const src = fs.readFileSync(abs, 'utf-8')
    const dir = path.posix.dirname(rel)
    const next = src.replace(LINK_RE, (match, label: string, href: string) => {
      if (isExternalHref(href)) return match
      const clean = href.split('#')[0]
      if (!clean.endsWith('.md')) return match
      const resolved = path.posix.normalize(dir === '.' ? clean : path.posix.join(dir, clean))
      if (resolved !== targetRel || label === newTitle) return match
      return `[${newTitle}](${href})`
    })
    if (next !== src) {
      fs.writeFileSync(abs, next, 'utf-8')
      changed.push(rel)
    }
  }
  return changed
}
