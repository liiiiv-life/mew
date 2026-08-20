import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WORKSPACE_ROOT } from './paths.ts'

export interface SkillSummary {
  name: string
  description: string
  path: string
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {}
  const end = content.indexOf('\n---', 3)
  if (end < 0) return {}
  const body = content.slice(3, end).trim()
  const values: Record<string, string> = {}
  for (const line of body.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    values[match[1]] = match[2].replace(/^["']|["']$/g, '').trim()
  }
  return values
}

function walkSkillFiles(root: string, depth = 4): string[] {
  if (depth < 0 || !fs.existsSync(root)) return []
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isFile() && entry.name === 'SKILL.md') found.push(full)
    else if (entry.isDirectory()) found.push(...walkSkillFiles(full, depth - 1))
  }
  return found
}

export function listSkills(): SkillSummary[] {
  const roots = [
    path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills'),
    path.join(WORKSPACE_ROOT, '.agents', 'skills'),
  ]
  const byName = new Map<string, SkillSummary>()
  for (const file of roots.flatMap((root) => walkSkillFiles(root))) {
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const meta = parseFrontmatter(content)
    const fallbackName = path.basename(path.dirname(file))
    const name = meta.name || fallbackName
    if (!name || byName.has(name)) continue
    byName.set(name, {
      name,
      description: meta.description || '',
      path: file,
    })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
