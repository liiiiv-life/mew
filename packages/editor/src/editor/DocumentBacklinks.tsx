import { useEffect, useRef, useState } from 'react'
import { uiText } from '@mew/ui/i18n-core'
import { FrontmatterPopover } from './FrontmatterPopover'
import type { EditorApi, DocumentBacklinksData } from '../types'

export function DocumentBacklinks({ path, fetchBacklinks, onOpenLink, mode = 'backlinks' }: {
  path: string
  fetchBacklinks: NonNullable<EditorApi['fetchBacklinks']>
  onOpenLink: (path: string) => void
  mode?: 'backlinks' | 'parents'
}) {
  const isParent = mode === 'parents'
  const label = uiText(isParent ? '상위파일' : '백링크')
  const openLink = useRef(onOpenLink)
  openLink.current = onOpenLink
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const [result, setResult] = useState<DocumentBacklinksData | null>(null)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  // Bind an open popup to its document; a tab handoff cannot show stale results.
  const openedPath = useRef(path)
  useEffect(() => { setAnchor(null); setResult(null); setFailed(false) }, [path, fetchBacklinks])
  useEffect(() => {
    if (!anchor || openedPath.current !== path) return
    const controller = new AbortController()
    setResult(null); setFailed(false)
    void fetchBacklinks(path, controller.signal).then(data => {
      if (controller.signal.aborted) return
      if (isParent && data.parents.length === 1) {
        setAnchor(null)
        openLink.current(data.parents[0].path)
      } else setResult(data)
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [anchor, path, fetchBacklinks, revision, isParent])
  useEffect(() => {
    if (!anchor || (!result && !failed)) return
    const container = list.current
    const focused = container?.ownerDocument.activeElement
    if (focused === anchor || focused && container?.contains(focused)) {
      (container?.querySelector<HTMLElement>('button') ?? container)?.focus({ preventScroll: true })
    }
  }, [anchor, result, failed])
  const close = () => setAnchor(null)
  const documents = result && (isParent ? result.parents : result.documents)
  return <>
    <button type="button" aria-label={label} data-tip={label} aria-haspopup="dialog" aria-expanded={!!anchor}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      onClick={event => { openedPath.current = path; setAnchor(anchor ? null : event.currentTarget) }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={isParent ? 'M12 19V5M5 12l7-7 7 7' : 'M6 18 18 6M6 6h12v12'} /></svg>
    </button>
    {anchor && openedPath.current === path && <FrontmatterPopover ignoreAnchor anchor={anchor} label={label} onClose={close}>
      <div ref={list} tabIndex={-1} className="w-80 max-w-[calc(100vw-24px)] outline-none">
        {!result && !failed && <div role="status" className="px-2 py-1.5 text-ink-secondary">{uiText('불러오는 중…')}</div>}
        {failed && <div className="px-2 py-1.5">
          <div role="alert" className="text-danger-strong">{uiText(isParent ? '상위파일을 불러오지 못했습니다' : '백링크를 불러오지 못했습니다')}</div>
          <button type="button" className="mt-1 rounded px-2 py-1 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent" onClick={() => setRevision(value => value + 1)}>{uiText('다시 시도')}</button>
        </div>}
        {documents && !documents.length && <div role="status" className="px-2 py-1.5 text-ink-secondary">{uiText(isParent ? '열 수 있는 상위파일이 없습니다' : '이 문서를 참조하는 문서가 없습니다')}</div>}
        {documents?.map(doc => <button key={doc.path} type="button" data-tip={doc.path}
          className="flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => { close(); onOpenLink(doc.path) }}>
          <span className="w-full truncate font-medium text-ink">{doc.title}</span>
          <span className="w-full truncate text-ink-secondary">{doc.path}</span>
        </button>)}
        {!!result?.skipped && <div role="status" className="border-t border-edge px-2 py-1.5 text-ink-secondary">{uiText('일부 문서를 확인하지 못했습니다')}</div>}
      </div>
    </FrontmatterPopover>}
  </>
}
