import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ClipboardEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { taskDocumentLink, taskDocumentLinks } from '../utils/task-document-links'
import { prefixMatch } from '@mew/editor'
import { useTaskDocuments } from './task-documents'
import { Plus, Xmark, Page } from 'iconoir-react'
import { useOverlayDismiss } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { TASK_TEXT_LIMIT } from '../../shared/task-list'
import { extractTaskTags, tagToken, validTag, TASK_TAG_LIMIT } from '../../shared/task-tags'
import { taskTagHue } from '../utils/task-tag-color'

export function TaskText({ id, text, tags = [], knownTags, disabled, inputs, onChange, onKeyDown, onPaste, onBlur, onFilter }: {
  id: string; text: string; tags?: string[]; knownTags: string[]; disabled: boolean
  inputs?: Map<string, HTMLTextAreaElement>; onChange: (text: string, tags: string[]) => void
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void; onBlur?: () => void; onFilter?: (tag: string) => void
}) {
  const documents = useTaskDocuments()
  const ref = useRef<HTMLTextAreaElement>(null), popup = useRef<HTMLDivElement>(null), listId = useId()
  const dismissed = useRef(false)
  const pendingCaret = useRef<number | null>(null)
  const [caret, setCaret] = useState<number | null>(null), [active, setActive] = useState(-1)
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 200 })
  const token = caret !== null && !disabled ? tagToken(text, caret) : null
  const mention = caret !== null && !disabled ? /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret)) : null
  const query = mention?.[1] ?? ''
  const mentioning = !!mention
  const loadDocuments = documents.load
  useLayoutEffect(() => { if (mentioning) loadDocuments() }, [mentioning, loadDocuments])
  const links = taskDocumentLinks(text)
  const fileChoices = mention ? documents.files.filter(path => prefixMatch(query, path.split('/').pop() ?? path)).sort((a, b) => a.localeCompare(b, 'ko-KR')).slice(0, 8) : []
  const matches = token ? knownTags.filter(tag => tag.startsWith(token.tag) && !tags.includes(tag)) : []
  const create = token && validTag(token.tag) && !tags.includes(token.tag) && !matches.includes(token.tag) ? token.tag : null
  const choices = mention ? fileChoices : [...matches, ...(create ? [create] : [])]
  const selected = mention && active < 0 ? 0 : active >= 0 ? Math.min(active, choices.length - 1) : choices.indexOf(token?.tag ?? '')
  const open = choices.length > 0 && (!!mention || !!token && tags.length < TASK_TAG_LIMIT)
  const dismiss = () => { dismissed.current = true; setCaret(null) }
  useOverlayDismiss(open ? dismiss : false, { escapePhase: 'capture' })
  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    const resize = () => { input.style.height = '0'; input.style.height = `${input.scrollHeight}px` }
    resize()
    if (pendingCaret.current !== null) { input.setSelectionRange(pendingCaret.current, pendingCaret.current); pendingCaret.current = null }
    const observer = new ResizeObserver(resize); observer.observe(input)
    return () => observer.disconnect()
  }, [text, tags])
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const rect = ref.current?.getBoundingClientRect(), viewport = window.visualViewport
      if (!rect) return
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const right = left + (viewport?.width ?? innerWidth), bottom = top + (viewport?.height ?? innerHeight)
      const width = Math.min(Math.max(rect.width, 220), 320, right - left - 16)
      const below = bottom - rect.bottom - 12, above = rect.top - top - 12
      const height = Math.min(224, Math.max(below, above))
      const actual = Math.min(height, choices.length * (window.matchMedia('(pointer: coarse)').matches ? 40 : 32) + 8)
      setPosition({ left: Math.max(left + 8, Math.min(rect.left, right - width - 8)), top: below >= actual ? rect.bottom + 4 : Math.max(top + 8, rect.top - actual - 4), width, maxHeight: Math.max(32, height) })
    }
    update()
    window.addEventListener('resize', update); window.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update); window.visualViewport?.addEventListener('scroll', update)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update) }
  }, [open, choices.length, text])
  useLayoutEffect(() => { if (open && active >= 0) popup.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [active, open])
  const confirm = (tag: string) => {
    if (mention && caret !== null) {
      const link = taskDocumentLink(tag)
      const start = caret - query.length - 1
      const next = text.slice(0, start) + link + text.slice(caret)
      if (next.length > TASK_TEXT_LIMIT) return false
      pendingCaret.current = start + link.length
      onChange(next, tags); dismiss(); setActive(-1); return true
    }
    if (!token || !validTag(tag) || (!tags.includes(tag) && tags.length >= TASK_TAG_LIMIT)) return false
    pendingCaret.current = token.start
    onChange(text.slice(0, token.start) + text.slice(token.end), tags.includes(tag) ? tags : [...tags, tag])
    dismiss(); setActive(-1)
    return true
  }
  return <div className="task-text" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onBlur?.() }}>
    {tags.length > 0 && <div className="task-tags" aria-label={uiText('태그')}>{tags.map(tag => <span key={tag} className="task-tag" style={{ '--task-tag-hue': taskTagHue(tag) } as CSSProperties}>
      {onFilter ? <button type="button" className="task-tag-name" onClick={() => onFilter(tag)}>{tag}</button> : <span className="task-tag-name">{tag}</span>}
      {!disabled && <button type="button" className="task-tag-remove" aria-label={`${uiText('태그 삭제')}: ${tag}`} data-tip={uiText('태그 삭제')} onClick={() => onChange(text, tags.filter(value => value !== tag))}><Xmark width={12} height={12} aria-hidden="true" /></button>}
    </span>)}</div>}
    <textarea ref={element => { ref.current = element; if (element) inputs?.set(id, element); else inputs?.delete(id) }} rows={1} value={text} readOnly={disabled} maxLength={TASK_TEXT_LIMIT}
      aria-label={uiText(id === 'draft' ? '새 태스크' : '태스크 내용')} aria-autocomplete="list" aria-haspopup="listbox" aria-controls={open ? listId : undefined} aria-activedescendant={open && selected >= 0 ? `${listId}-${selected}` : undefined}
      onSelect={event => { const input = event.currentTarget; if (!dismissed.current && input === input.ownerDocument.activeElement && input.selectionStart === input.selectionEnd) setCaret(input.selectionStart) }}
      onChange={event => {
        dismissed.current = false
        const value = event.currentTarget.value, offset = event.currentTarget.selectionStart
        const extracted = (event.nativeEvent as InputEvent).isComposing ? { text: value, tags } : extractTaskTags(value, tags, true)
        if (extracted.text !== value) pendingCaret.current = extractTaskTags(value.slice(0, offset), tags, true).text.length
        onChange(extracted.text, extracted.tags); setCaret(extracted.text === value ? offset : null); setActive(-1)
      }} onKeyDown={event => {
        if (disabled || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setActive(index => { const current = index < 0 ? mention ? 0 : -1 : index; return current < 0 ? event.key === 'ArrowDown' ? 0 : choices.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length }); return }
        if (mention && open && !event.shiftKey && (event.key === 'Enter' || event.key === 'Tab')) { if (confirm(choices[Math.max(0, selected)])) event.preventDefault(); return }
        if (token && !event.shiftKey && (event.key === ' ' || event.key === 'Enter' || (open && event.key === 'Tab'))) {
          const tag = event.key === ' ' || tags.includes(token.tag) || (active < 0 && token.tag) ? token.tag : choices[Math.max(0, Math.min(active, choices.length - 1))] ?? token.tag
          if (confirm(tag)) { event.preventDefault(); return }
        }
        onKeyDown?.(event)
      }} onPaste={onPaste} onBlur={dismiss} />


    {documents.open && links.length > 0 && <div className="task-document-links">{links.map((link, index) => <button key={index} type="button" onClick={() => documents.open?.(link.path)}><Page width={12} height={12} aria-hidden="true" />{link.label}</button>)}</div>}
    {open && createPortal(<div ref={popup} id={listId} role="listbox" aria-label={uiText(mention ? '파일명 검색' : '태그 자동완성')} className="task-tag-suggestions" style={position}>
      {choices.map((tag, index) => <button key={tag} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={selected === index} onPointerDown={event => event.preventDefault()} onClick={() => confirm(tag)} onPointerMove={() => setActive(index)}>
        <span className="task-tag-hash" aria-hidden="true">{mention ? <Page width={14} height={14} /> : '#'}</span><span className="task-tag-result">{token?.tag && <strong>{tag.slice(0, token.tag.length)}</strong>}{tag.slice(token?.tag.length ?? 0)}</span>
        {!mention && tag === create && <Plus width={14} height={14} aria-label={uiText('태그 추가')} />}
      </button>)}
    </div>, document.body)}
  </div>
}
