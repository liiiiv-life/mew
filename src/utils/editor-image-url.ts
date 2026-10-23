import { isExternalHref, resolveRelativePath } from '../../packages/editor/src/utils/fuzzy.ts'
import { editorFile, editorLinkTabPath } from './editor-files.ts'
import { externalAbsolutePath, isExternalTabPath } from './externalFiles.ts'
import { appResourceUrl } from '../runtime/app-runtime.ts'

export function editorImageUrl(src: string, documentPath: string, project: string,
  workspace?: { path: string; docsPath?: string } | null): string {
  if (!src || isExternalHref(src) || src.startsWith('/api/') || src.startsWith('#') || src.startsWith('?')) return appResourceUrl(src)
  const resolved = resolveRelativePath(documentPath, src)
  const target = editorLinkTabPath(project, resolved, workspace)
  const fragment = src.includes('#') ? src.slice(src.indexOf('#')) : ''
  if (isExternalTabPath(target)) return appResourceUrl(`/api/fs/raw?path=${encodeURIComponent(externalAbsolutePath(target))}${fragment}`)
  const file = editorFile(target)
  return appResourceUrl(`/api/raw?path=${encodeURIComponent(file.path)}&project=${encodeURIComponent(file.project)}${fragment}`)
}
