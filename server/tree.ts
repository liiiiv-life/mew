import fs from 'node:fs'
import path from 'node:path'
import { DOCS_ROOT } from './paths'

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: TreeNode[]
}

export const IGNORE = new Set(['.git', 'node_modules', '.foam', '.github', '.obsidian', '.tokensave', '.vscode'])

const TOP_LEVEL_DIR_ORDER = ['.new', 'company', 'products', 'programs', 'events', 'ops', 'decisions', 'archives']

function topLevelRank(name: string): number {
  const index = TOP_LEVEL_DIR_ORDER.indexOf(name)
  return index === -1 ? TOP_LEVEL_DIR_ORDER.length : index
}

function walk(absDir: string, relDir: string): TreeNode[] {
  const entries = fs.readdirSync(absDir, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
    const absPath = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, path: relPath, type: 'dir', children: walk(absPath, relPath) })
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      nodes.push({ name: entry.name, path: relPath, type: 'file' })
    }
  }
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    if (relDir === '' && a.type === 'dir') {
      const rankDiff = topLevelRank(a.name) - topLevelRank(b.name)
      if (rankDiff !== 0) return rankDiff
    }
    return a.name.localeCompare(b.name)
  })
  return nodes
}

export function buildTree(): TreeNode[] {
  return walk(DOCS_ROOT, '')
}