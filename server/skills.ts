import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WORKSPACE_ROOT } from './paths.ts'
import { parseConfig } from './harness-config.ts'
import { readAgentSetting } from './agentSettings.ts'
import { ensureCommitSkill, MEW_SKILLS_DIR } from './mew-skills.ts'

export interface SkillSummary {
  name: string
  description: string
  path: string
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {}
  const end = content.indexOf('\n---', 3)
  if (end < 0) return {}
  try { return Object.fromEntries(Object.entries(parseConfig(content.slice(3, end), 'yaml')).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) } catch { return {} }
}

function walkSkillFiles(root: string, depth = 6, seen = new Set<string>(), flat = false): string[] {
  if (depth < 0 || !fs.existsSync(root)) return []
  let entries: fs.Dirent[]
  try {
    const real = fs.realpathSync(root)
    if (seen.has(real)) return []
    seen.add(real)
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isFile() && (entry.name === 'SKILL.md' || flat && entry.name.endsWith('.md') && !fs.existsSync(path.join(root, entry.name.slice(0, -3), 'SKILL.md')))) found.push(full)
    else if (entry.isDirectory() || entry.isSymbolicLink()) found.push(...walkSkillFiles(full, depth - 1, seen))
  }
  return found
}

export function listSkills(cwd = WORKSPACE_ROOT, runtime = 'codex', home = os.homedir(), env: NodeJS.ProcessEnv = { ...process.env, ...(runtime === 'claude' && process.env.MEW_AGENT_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: process.env.MEW_AGENT_CONFIG_DIR } : {}), ...readAgentSetting(runtime)?.env }): SkillSummary[] {
  const runtimeDirs: Record<string, string> = { codex: '.codex', claude: '.claude', cursor: '.cursor', opencode: '.opencode', kimi: '.kimi-code', antigravity: '.agent', prime: '.prime/agent', openclaw: '' }
  const globalDirs: Record<string, string> = {
    codex: env.CODEX_HOME || path.join(home, '.codex'), claude: env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'),
    cursor: path.join(home, '.cursor'), opencode: path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'opencode'),
    kimi: env.KIMI_CODE_HOME || path.join(home, '.kimi-code'), antigravity: path.join(env.GEMINI_HOME || path.join(home, '.gemini'), 'antigravity'),
    prime: path.join(home, '.prime/agent'), hermes: env.HERMES_HOME || path.join(home, '.hermes'), openclaw: env.OPENCLAW_STATE_DIR || path.join(home, '.openclaw'),
  }
  ensureCommitSkill()
  const roots: string[] = [MEW_SKILLS_DIR]
  // The nearest project wins. Descendant/sibling projects never leak into the current prompt.
  let current = path.resolve(cwd)
  while (true) {
    if (Object.hasOwn(runtimeDirs, runtime)) roots.push(path.join(current, runtimeDirs[runtime], 'skills'))
    roots.push(path.join(current, '.agents/skills'))
    if (fs.existsSync(path.join(current, '.git')) || path.dirname(current) === current) break
    current = path.dirname(current)
  }
  if (globalDirs[runtime]) roots.push(path.join(globalDirs[runtime], 'skills'))
  roots.push(path.join(home, '.agents/skills'))
  const byName = new Map<string, SkillSummary>()
  for (const file of roots.flatMap((root) => walkSkillFiles(root, 6, new Set(), ['prime', 'kimi'].includes(runtime) && !root.endsWith(path.join('.agents', 'skills'))))) {
    let content = ''
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const meta = parseFrontmatter(content)
    const fallbackName = path.basename(file) === 'SKILL.md' ? path.basename(path.dirname(file)) : path.basename(file, '.md')
    const name = file === path.join(MEW_SKILLS_DIR, 'commit', 'SKILL.md') ? 'commit' : meta.name || fallbackName
    if (!name || byName.has(name)) continue
    byName.set(name, {
      name,
      description: meta.description || '',
      path: file,
    })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
