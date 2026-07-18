import type { TreeNode } from '../api/client'

export function flattenFiles(tree: TreeNode[]): string[] {
  const out: string[] = []
  for (const node of tree) {
    if (node.type === 'file') out.push(node.path)
    else if (node.children) out.push(...flattenFiles(node.children))
  }
  return out
}

/** 절대 URL(스킴 있음) 여부 — 내부 문서 상대 경로와 구분해서 새 탭/내부 탭을 가른다 */
export function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')
}

/** fromDocPath가 속한 문서에서 toDocPath로 향하는 상대 경로 (마크다운 링크용) */
export function relativeLinkPath(fromDocPath: string, toDocPath: string): string {
  const fromDir = fromDocPath.split('/').slice(0, -1)
  const toParts = toDocPath.split('/')
  let i = 0
  while (i < fromDir.length && i < toParts.length - 1 && fromDir[i] === toParts[i]) i++
  const ups = fromDir.length - i
  return [...Array(ups).fill('..'), ...toParts.slice(i)].join('/')
}

/** relativeLinkPath의 역연산 — fromDocPath가 속한 문서 기준 상대 href가 가리키는 절대 문서 경로 */
export function resolveRelativePath(fromDocPath: string, relativeHref: string): string {
  const [hrefPath] = relativeHref.split('#')
  const stack = fromDocPath.split('/').slice(0, -1)
  for (const part of hrefPath.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let ti = 0
  let start = -1
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti)
    if (idx === -1) return null
    if (start === -1) start = idx
    ti = idx + 1
  }
  return (ti - start) * 1000 + start
}
