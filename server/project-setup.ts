import { localizedProjectTemplates } from './project-setup-copy.ts'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { defaultAgentSettings, normalizeAgentSettings, ProjectSetupError, readProjectAgentSettings, safeProjectPath, SETTINGS_PATH, writeProjectAgentSettings } from './project-agent-settings.ts'
import { describeAgentContext } from './project-context-text.ts'
import type { ProjectSetupInput, ProjectSetupPlan } from '../shared/project-agent-context.ts'

function templates(input: ProjectSetupInput): Map<string, string> {
  const docs = input.settings.docsDir
  const link = (p: string) => p.split('/').map(encodeURIComponent).join('/')
  const files = new Map<string, string>()
  if (input.initDocs) {
    files.set(`${docs}/AGENT.md`, '---\ndescription: "Agent entrypoint for project instructions and selecting canonical documents by description."\n---\n\n# Agent entrypoint\n\nRead [documentation rules](README.md) and existing project instructions. Scan document paths and frontmatter description fields before reading the bodies of only the current documents needed for the task. MOC navigation and registration are not required. Update the canonical source before reporting completion.\n')
    files.set(`${docs}/README.md`, '---\ndescription: "Documentation rules for description-based discovery, canonical ownership, write-back and historical preservation."\n---\n\n# Documentation rules\n\n[Agent entrypoint](AGENT.md)\n\nKeep one canonical source per fact. Link to existing project documentation instead of copying it. Keep current guidance separate from history and raw research; preserve historical originals.\n\nBefore work, read the project README and relevant instructions. Scan document paths and frontmatter description fields to select the current documents for your scope, then read only their bodies. Follow existing decision records; record a new decision before reversing an established contract. Do not load the entire document tree. MOC navigation and registration are not required.\n\nWhen code, features, or operating procedures change, update the owning document in the same task. Give every document an accurate frontmatter description that distinguishes its content, and update it when the content changes. Fix existing links when documents move. Never store secrets or temporary debug logs in documentation.\n')
    files.set('README.md', `# Project\n\nDocument the purpose, setup, required configuration, validation commands, and runtime invariants here.\n\nDocumentation: [rules](${link(docs)}/README.md) · [agent entrypoint](${link(docs)}/AGENT.md).\n`)
  }
  if (input.exportAgents) {
    if (!input.initDocs && !fs.existsSync(safeProjectPath(input.projectRoot, `${docs}/AGENT.md`))) throw new ProjectSetupError('먼저 문서 기본 구조를 만들거나 Documents에 AGENT.md를 준비하세요')
    files.set('AGENTS.md', `Follow existing project instructions and read the project README if present.\nFor documentation navigation and write-back, start at [Documents](${link(docs)}/AGENT.md).\n`)
  }
  if (input.initDocs) for (const [name, content] of localizedProjectTemplates(input.locale, docs) ?? []) files.set(name, content)
  return files
}

export function planProjectSetup(input: ProjectSetupInput): ProjectSetupPlan {
  if (typeof input.projectRoot !== 'string' || !path.isAbsolute(input.projectRoot)) throw new ProjectSetupError('프로젝트 절대 경로가 필요합니다')
  const projectRoot = path.resolve(input.projectRoot)
  if (!fs.existsSync(projectRoot) && !input.create) throw new ProjectSetupError('없는 프로젝트입니다. 새 프로젝트 생성 옵션을 선택하세요')
  if (fs.existsSync(projectRoot) && !fs.lstatSync(projectRoot).isDirectory()) throw new ProjectSetupError('실제 프로젝트 폴더가 필요합니다')
  const settings = normalizeAgentSettings(projectRoot, input.settings)
  for (const entry of settings.entrypoints) {
    if (!fs.existsSync(safeProjectPath(projectRoot, entry))) throw new ProjectSetupError(`문서 진입점 파일을 찾을 수 없습니다: ${entry}`)
  }
  const previous = readProjectAgentSettings(projectRoot)
  const docsRoot = safeProjectPath(projectRoot, settings.docsDir)
  if (!fs.existsSync(docsRoot) && !input.initDocs) throw new ProjectSetupError('Documents 폴더가 없습니다. 문서 기본 구조 만들기를 선택하세요')
  const files: ProjectSetupPlan['files'] = [{ path: SETTINGS_PATH, action: previous ? JSON.stringify(previous) === JSON.stringify(settings) ? 'preserve' : 'update' : 'create' }]
  for (const name of templates({ ...input, projectRoot, settings }).keys()) {
    const target = safeProjectPath(projectRoot, name)
    if (fs.existsSync(target) && !fs.statSync(target).isFile()) throw new ProjectSetupError(`파일 위치에 폴더가 있습니다: ${name}`)
    files.push({ path: name, action: fs.existsSync(target) ? 'preserve' : 'create' })
  }
  const revision = crypto.createHash('sha256').update(JSON.stringify({ projectRoot, previous, settings, files, locale: input.locale ?? 'en' })).digest('hex')
  return { projectRoot, settings, files, revision, context: describeAgentContext({ projectRoot, docsRoot }, settings, projectRoot) }
}

/** Replan at apply time. Existing content is never replaced, including competing creates. */
export function applyProjectSetup(input: ProjectSetupInput, revision: string): ProjectSetupPlan {
  const plan = planProjectSetup(input)
  if (plan.revision !== revision) throw new ProjectSetupError('설정이나 파일이 변경되었습니다. 미리보기를 다시 확인하세요')
  fs.mkdirSync(plan.projectRoot, { recursive: true })
  for (const [name, content] of templates({ ...input, settings: plan.settings })) {
    const file = safeProjectPath(plan.projectRoot, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    try { fs.writeFileSync(file, content, { flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  }
  writeProjectAgentSettings(plan.projectRoot, plan.settings)
  return plan
}

export { defaultAgentSettings, readProjectAgentSettings }
