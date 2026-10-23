import { isNode, parseDocument } from 'yaml'
import type { FileLinkContext } from '../editor/file-link'
import type { FrontmatterField } from './frontmatter'
import { resolveRelativePath } from './fuzzy.ts'

export type FeatureReferences =
  | { kind: 'files'; items: string[] }
  | { kind: 'commits'; items: { repository: string; hash: string; subject?: string }[] }

export function isFeatureDocument(context?: FileLinkContext): boolean {
  if (!context?.projectRoot) return false
  const root = resolveRelativePath(`${context.docsRoot}/_`, '.').replace(/\/$/, '')
  return context.path.startsWith(`${root}/features/`) && /\.md$/i.test(context.path)
}

export function featureReferences(field: FrontmatterField): FeatureReferences | null {
  if (field.type || !['files', 'commits'].includes(field.key)) return null
  try {
    const items: unknown = JSON.parse(field.value)
    if (!Array.isArray(items)) return null
    const relative = (value: unknown): value is string => typeof value === 'string' && !!value && !/^[a-z][a-z0-9+.-]*:/i.test(value)
      && !value.startsWith('/') && !value.includes('\\') && !value.includes('\0') && !value.split('/').includes('..')
    if (field.key === 'files' && items.every(relative)) return { kind: 'files', items }
    if (field.key === 'commits' && items.every(item => item && typeof item === 'object'
      && (item.repository === '' || item.repository === '.' || relative(item.repository))
      && typeof item.hash === 'string' && /^[0-9a-f]{7,64}$/i.test(item.hash)
      && (item.subject === undefined || typeof item.subject === 'string'))) return { kind: 'commits', items }
  } catch { /* Invalid or custom values keep the ordinary property editor. */ }
  return null
}

export function updateFeatureReferences(field: FrontmatterField, value: string): FrontmatterField {
  const yaml = parseDocument(field.source?.key === field.key ? field.source.yaml : '')
  const before = yaml.get(field.key, true)
  const next = yaml.createNode(JSON.parse(value))
  if (isNode(before)) {
    next.comment = before.comment
    next.commentBefore = before.commentBefore
    next.spaceBefore = before.spaceBefore
  }
  yaml.set(field.key, next)
  return { ...field, value, source: { key: field.key, value, yaml: yaml.toString().trimEnd() } }
}

export function featureFilePath(projectRoot: string, file: string): string {
  return resolveRelativePath(`${projectRoot}/_`, file.split('/').map(encodeURIComponent).join('/'))
}
