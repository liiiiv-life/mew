import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './dataDir.ts'

export const MEW_SKILLS_DIR = path.join(DATA_DIR, 'skills')
export const COMMIT_SKILL_PATH = path.join(MEW_SKILLS_DIR, 'commit', 'SKILL.md')

/** A user-editable source, seeded once and never copied into a runtime's skill tree. */
export function ensureCommitSkill(root = MEW_SKILLS_DIR): string {
  const file = path.join(root, 'commit', 'SKILL.md')
  try { fs.lstatSync(file); return file }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = fs.mkdtempSync(path.join(root, '.seed-'))
  try {
    const seed = path.join(temporary, 'skill')
    fs.writeFileSync(seed, fs.readFileSync(new URL('./prompts/commit-skill.txt', import.meta.url)), { mode: 0o600 })
    try { fs.linkSync(seed, file) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
  return file
}

export function readCommitSkill(): { path: string; content: string } {
  const file = ensureCommitSkill()
  if (fs.statSync(file).size > 128_000) throw new Error('Mew 커밋 스킬은 128KB 이하여야 합니다')
  const content = fs.readFileSync(file, 'utf8')
  if (!content.trim()) throw new Error('Mew 커밋 스킬이 비어 있습니다. Skills 관리에서 지침을 작성하세요.')
  return { path: file, content }
}

export function commitSkillGuidance(): string {
  return `Mew commit skill: ${JSON.stringify(ensureCommitSkill())}\nWhen a commit is authorized by the user or the shared commit setting, read this file and follow it to split changes into logical commits. This notice alone does not authorize a commit. Do not use runtime-specific copies of the commit skill.`
}
