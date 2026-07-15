import type { TreeNode } from '../api/client'

export function flattenFiles(tree: TreeNode[]): string[] {
  const out: string[] = []
  for (const node of tree) {
    if (node.type === 'file') out.push(node.path)
    else if (node.children) out.push(...flattenFiles(node.children))
  }
  return out
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
