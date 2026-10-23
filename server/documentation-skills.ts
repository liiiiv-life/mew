import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guidanceOptions } from '../shared/agent-guidance.ts'
import { parseConfig } from './harness-config.ts'

export const DOCUMENTATION_SKILLS_DIR = fileURLToPath(new URL('../docs/configuration/skills/', import.meta.url))
export const documentationSkills = {
  ko: { name: 'korean-technical-docs', language: 'Korean' },
  en: { name: 'english-technical-docs', language: 'English' },
  ja: { name: 'japanese-technical-docs', language: 'Japanese' },
  'zh-CN': { name: 'chinese-technical-docs', language: 'Simplified Chinese' },
} as const
export type DocumentationLocale = keyof typeof documentationSkills

export interface DocumentationDependencies {
  version: number
  structure: string
  translation: { core: string; surface: string; review: string }
  languages: Record<DocumentationLocale, { editor: string; translator: string; targetLocale: string }>
  packages: { name: string; role: string; repository: string; revision: string; sourcePath: string; license: string; files: { path: string; sha256: string }[] }[]
}

export function readDocumentationDependencies(root = DOCUMENTATION_SKILLS_DIR): DocumentationDependencies {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dependencies.json'), 'utf8')) as DocumentationDependencies
  if (manifest.version !== 1 || !Array.isArray(manifest.packages) || manifest.packages.some(entry => !/^[a-z0-9-]+$/.test(entry.name))) throw new Error('Invalid documentation dependency manifest')
  return manifest
}

export function listDocumentationDependencies(root = DOCUMENTATION_SKILLS_DIR) {
  return readDocumentationDependencies(root).packages.map(entry => {
    const file = path.join(root, '.vendor', entry.name, 'SKILL.md')
    const content = fs.readFileSync(file, 'utf8')
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
    const metadata = match ? parseConfig(match[1], 'yaml') : {}
    if (metadata.name !== entry.name || typeof metadata.description !== 'string' || !metadata.description.trim()) throw new Error(`Invalid documentation dependency: ${file}`)
    return { name: entry.name, path: file, description: metadata.description }
  })
}

export function listDocumentationSkills(root = DOCUMENTATION_SKILLS_DIR) {
  return Object.entries(documentationSkills).map(([locale, skill]) => {
    const file = path.join(root, skill.name, 'SKILL.md')
    const content = fs.readFileSync(file, 'utf8')
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
    const metadata = frontmatter ? parseConfig(frontmatter[1], 'yaml') : {}
    if (metadata.name !== skill.name || typeof metadata.description !== 'string' || !metadata.description.trim()) throw new Error(`Invalid documentation skill: ${file}`)
    return { ...skill, locale: locale as DocumentationLocale, path: file, description: metadata.description }
  })
}

/** Read the resolved response setting, without guessing the meaning of custom instructions. */
export function documentationLocale(guidance: string): DocumentationLocale | undefined {
  const start = '<!-- mew:agent-setting:language -->', end = '<!-- /mew:agent-setting:language -->'
  const from = guidance.indexOf(start), to = guidance.indexOf(end)
  if (from < 0 || to < from || guidance.indexOf(start, from + start.length) >= 0 || guidance.indexOf(end, to + end.length) >= 0) return undefined
  const text = guidance.slice(from + start.length, to).trim()
  for (const locale of Object.keys(documentationSkills) as DocumentationLocale[]) {
    const key = locale === 'zh-CN' ? 'zh' : locale
    if (text === guidanceOptions.language[key]) return locale
  }
  return undefined
}

/** Add paths only: agents load the source skill and requested target skills when documenting. */
export function withDocumentationSkillGuidance(guidance: string): string {
  const locale = documentationLocale(guidance)
  const skills = locale ? [documentationSkills[locale]] : Object.values(documentationSkills)
  const selection = locale
    ? `Default documentation source language: ${documentationSkills[locale].language} (${locale}), following the resolved agent response-language setting.`
    : 'Default documentation source language: follow the active response-language instructions; if unspecified, use the user message language. Custom language instructions remain authoritative. Select the matching skill below.'
  return [guidance, [
    selection,
    'For technical documentation tasks, read the matching source-language skill before designing structure and editing prose. Explicit document-language requests and existing project/file language requirements take precedence; preserve existing file languages. For requested translations, finalize the source first, translate directly from that source, and read each target-language skill for local phrasing. Do not translate or rewrite unrelated documents without a request. Resolve shared references relative to the real skill file path.',
    ...skills.map(skill => `${skill.language}: $${skill.name} — ${JSON.stringify(path.join(DOCUMENTATION_SKILLS_DIR, skill.name, 'SKILL.md'))}`),
  ].join('\n')].filter(Boolean).join('\n\n')
}
