import { canAutoFocusInput } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useEffect, useRef, useState } from 'react'
import type { FrontmatterField } from '../utils/frontmatter'
import { featureFilePath, featureReferences, updateFeatureReferences, type FeatureReferences } from '../utils/feature-frontmatter'
import { FrontmatterTag } from './FrontmatterTag'
import { fileLinkKind, type FileLinkContext } from './file-link'
import type { EditorOpenLink } from '../types'

export function FrontmatterFeatureReferences({ field, references, context, readOnly, busy, onChange, onOpenFile }: {
  field: FrontmatterField; references: FeatureReferences; context: FileLinkContext; readOnly?: boolean; busy?: boolean
  onChange: (field: FrontmatterField) => void; onOpenFile?: EditorOpenLink
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null
  const input = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  const valid = draft === null || !!featureReferences({ ...field, value: draft })
  useEffect(() => {
    if (editing && canAutoFocusInput()) input.current?.focus()
  }, [editing])
  const save = () => {
    if (cancelled.current || readOnly || busy || draft === null || !valid) return
    if (draft !== field.value) onChange(updateFeatureReferences(field, draft))
    setDraft(null)
  }
  if (draft !== null && !readOnly) return <input ref={input} value={draft} readOnly={busy} aria-label={field.key} aria-invalid={!valid || undefined}
    className="min-w-0 flex-1 rounded border border-edge bg-transparent px-1 py-0.5 text-xs text-ink-secondary outline-none focus:border-edge-bright"
    onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); save() }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(null) }
    }} />
  return <div className="flex min-w-0 flex-1 items-start gap-1" data-feature-references={references.kind}>
    <div className="min-w-0 flex-1 px-1 py-0.5 text-xs leading-6">
      {references.kind === 'files' ? references.items.map((file, index) => {
        const path = featureFilePath(context.projectRoot!, file), href = path.split('/').map(encodeURIComponent).join('/')
        return <a key={index} data-file-link="" data-file-link-kind={fileLinkKind(href, context)}
          href={href} title={file} aria-disabled={!onOpenFile || undefined}
          onClick={event => { event.preventDefault(); onOpenFile?.(path, { newTab: event.ctrlKey || event.metaKey }) }}>{file}</a>
      })
        : <div className="flex flex-wrap items-center gap-1">{references.items.map((commit, index) => <FrontmatterTag key={index}
          title={[commit.repository || '.', commit.hash, commit.subject].filter(Boolean).join('\n')}>{commit.hash.slice(0, 7)}</FrontmatterTag>)}</div>}
    </div>
    {!readOnly && <button type="button" disabled={busy} aria-label={`${field.key} ${uiText('편집')}`} data-tip={uiText('편집')}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
      onClick={() => { cancelled.current = false; setDraft(field.value) }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m16 3 5 5L9 20l-6 1 1-6L16 3Z" /></svg>
    </button>}
  </div>
}
