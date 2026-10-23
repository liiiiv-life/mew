import { canAutoFocusInput, keepFocusOnPress, useOverlayDismiss } from '@mew/ui'
import { getVirtualKeyboard, virtualKeyboardViewportBottom } from '@mew/ui/virtual-keyboard'
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChatBubble, Check, EditPencil, Quote, RefreshDouble, SendDiagonal, Trash, Xmark } from 'iconoir-react'
import type { CommentEntry, CommentThread } from '../api/client'
import { identityColor } from '../utils/collabColor'
import { MentionTextarea, memberMentionOptions } from './MentionTextarea'
import { useI18n } from '../i18n'
import './Comments.css'

type CommentAction = () => void | Promise<void>

function useGrowingTextarea(value: string, active = true) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const input = ref.current
    if (!input || !active) return
    const fit = () => {
      input.style.height = 'auto'
      const limit = Number.parseFloat(getComputedStyle(input).maxHeight) || 160
      input.style.height = `${Math.min(limit, input.scrollHeight)}px`
      input.style.overflowY = input.scrollHeight > limit ? 'auto' : 'hidden'
    }
    fit()
    let width = input.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const nextWidth = input.getBoundingClientRect().width
      if (nextWidth === width) return
      width = nextWidth
      fit()
    })
    observer.observe(input)
    return () => observer.disconnect()
  }, [value, active])
  return ref
}

function useCommentRequest() {
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const run = async (action: CommentAction, done?: () => void) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setFailed(false)
    try { await action(); done?.() } catch { setFailed(true) }
    finally { busyRef.current = false; setBusy(false) }
  }
  return { busy, failed, run }
}

function CommentError({ failed }: { failed: boolean }) {
  const { t } = useI18n()
  return failed ? <p role="alert" className="comment-error">{t('comment.saveFailed')}</p> : null
}

function CommentHeader({ count, onClose }: { count?: number; onClose: () => void }) {
  const { t } = useI18n()
  return <div className="comment-header">
    <ChatBubble width={15} height={15} aria-hidden="true" />
    <span>{count === undefined ? t('comment.title') : t('comment.listTitle')}</span>
    {count !== undefined && <span className="comment-count">{count}</span>}
    <button type="button" className="comment-icon comment-close" onClick={onClose} title={t('comment.close')} aria-label={t('comment.close')}><Xmark width={15} height={15} aria-hidden="true" /></button>
  </div>
}

function CommentQuote({ text }: { text: string }) {
  return text ? <div className="comment-quote" title={text}><Quote width={13} height={13} aria-hidden="true" /><span>{text}</span></div> : null
}

function CommentAvatar({ author }: { author: string }) {
  const name = author.split('@')[0] || author
  return <span className="comment-avatar" style={{ '--comment-author': identityColor(author) } as CSSProperties} aria-hidden="true">{[...name][0]?.toLocaleUpperCase()}</span>
}

/** Shared placement keeps comments above panel boundaries and the mobile keyboard. */
export function CommentPopover({ x, y, onClose, children, label, anchorRef, outsideIgnore }: {
  x: number
  y: number
  onClose: () => void
  children: ReactNode
  label?: string
  anchorRef?: RefObject<HTMLButtonElement | null>
  outsideIgnore?: () => Element | null
}) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y + 6, maxHeight: 384 })
  useOverlayDismiss(onClose, { outside: () => ref.current, outsideIgnore: outsideIgnore ?? (() => anchorRef?.current ?? null) })
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current
      if (!el) return
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth
      const bottom = Math.min(top + (viewport?.height ?? window.innerHeight), virtualKeyboardViewportBottom(window))
      const rect = el.getBoundingClientRect()
      const anchor = anchorRef?.current?.getBoundingClientRect()
      const atX = anchor ? anchor.right - rect.width : x
      const atY = anchor?.bottom ?? y
      const maxHeight = Math.max(64, Math.min(384, bottom - top - 16))
      const height = Math.min(rect.height, maxHeight)
      const below = atY + 6
      setPos({
        left: Math.max(left + 8, Math.min(atX, left + width - rect.width - 8)),
        top: Math.max(top + 8, Math.min(below + height <= bottom - 8 ? below : atY - height - 6, bottom - height - 8)),
        maxHeight,
      })
    }
    place()
    const observer = new ResizeObserver(place)
    if (ref.current) observer.observe(ref.current)
    const keyboard = getVirtualKeyboard(window)
    keyboard?.addEventListener('geometrychange', place)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      keyboard?.removeEventListener('geometrychange', place)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [x, y, anchorRef])
  return createPortal(<div ref={ref} role="dialog" aria-label={label ?? t('comment.title')} className="comment-popover mew-overlay-surface bg-surface-raised" style={pos} onPointerDown={event => event.stopPropagation()} onMouseDown={keepFocusOnPress}>{children}</div>, document.fullscreenElement ?? document.body)
}

export function CommentComposer({ quote, members, onSubmit, onClose }: {
  quote: string
  members: string[]
  onSubmit: (text: string) => void | Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const inputRef = useGrowingTextarea(text)
  const { busy, failed, run } = useCommentRequest()
  const submit = () => { if (text.trim()) void run(() => onSubmit(text)) }
  return <>
    <CommentHeader onClose={onClose} />
    <div className="comment-compose">
      <CommentQuote text={quote} />
      <fieldset className="comment-input-shell" disabled={busy}>
        <MentionTextarea inputRef={inputRef} value={text} onChange={setText} options={memberMentionOptions(members)} onSubmit={submit} rows={2} autoFocus={canAutoFocusInput()} placeholder={t('comment.inputPlaceholder')} submitHint={t('comment.inputLabel')} className="comment-textarea" />
        <div className="comment-input-actions"><button type="button" onClick={submit} disabled={!text.trim() || busy} className="comment-send" aria-label={t('comment.add')} title={t('comment.add')} aria-busy={busy}>{busy ? <RefreshDouble width={15} height={15} className="motion-safe:animate-spin" aria-hidden="true" /> : <SendDiagonal width={15} height={15} aria-hidden="true" />}</button></div>
      </fieldset>
      <CommentError failed={failed} />
    </div>
  </>
}

function CommentRow({ comment, canEdit, onEdit, onDelete }: {
  comment: CommentEntry
  canEdit: boolean
  onEdit: (text: string) => void | Promise<void>
  onDelete: CommentAction
}) {
  const { formatDate, t } = useI18n()
  const [editing, setEditing] = useState<string | null>(null)
  const inputRef = useGrowingTextarea(editing ?? '', editing !== null)
  const { busy, failed, run } = useCommentRequest()
  useOverlayDismiss(editing !== null ? () => setEditing(null) : false, { closeOnEscape: () => !busy })
  const save = () => { if (editing?.trim()) void run(() => onEdit(editing), () => setEditing(null)) }
  return <div className="comment-item" aria-busy={busy}>
    <CommentAvatar author={comment.author} />
    <div className="comment-item-main">
      <div className="comment-meta">
        <span className="comment-author" title={comment.author}>{comment.author.split('@')[0] || comment.author}</span>
        <time className="comment-time" dateTime={new Date(comment.time).toISOString()} title={formatDate(comment.time, { dateStyle: 'medium', timeStyle: 'short' })}>{formatDate(comment.time, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{comment.edited ? ` · ${t('comment.edited')}` : ''}</time>
        {canEdit && editing === null && <span className="comment-item-tools">
          <button type="button" onClick={() => setEditing(comment.text)} disabled={busy} className="comment-icon" aria-label={t('comment.edit')} title={t('comment.edit')}><EditPencil width={13} height={13} aria-hidden="true" /></button>
          <button type="button" onClick={() => void run(onDelete)} disabled={busy} className="comment-icon comment-delete" aria-label={t('comment.delete')} title={t('comment.delete')}><Trash width={13} height={13} aria-hidden="true" /></button>
        </span>}
      </div>
      {editing === null ? <div className="comment-body select-text">{comment.text}</div> : <div className="comment-input-shell">
        <textarea ref={inputRef} autoFocus={canAutoFocusInput()} value={editing} onChange={event => setEditing(event.target.value)} readOnly={busy} onKeyDown={event => {
          if (event.key === 'Escape') { event.stopPropagation(); setEditing(null) }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); save() }
        }} rows={2} className="comment-textarea" aria-label={t('comment.editInput')} />
        <div className="comment-input-actions">
          <button type="button" onClick={() => setEditing(null)} disabled={busy} className="comment-icon" aria-label={t('common.cancel')} title={t('common.cancel')}><Xmark width={15} height={15} aria-hidden="true" /></button>
          <button type="button" onClick={save} disabled={!editing.trim() || busy} className="comment-send" aria-label={t('common.save')} title={t('common.save')}><Check width={15} height={15} aria-hidden="true" /></button>
        </div>
      </div>}
      <CommentError failed={failed} />
    </div>
  </div>
}

export function CommentThreadView({ thread, authEmail, isOwner, members, notice, onReply, onEdit, onDelete, onClose, readOnly = false }: {
  readOnly?: boolean
  thread: CommentThread
  authEmail: string | null
  isOwner: boolean
  members: string[]
  notice?: string
  onReply: (text: string) => void | Promise<void>
  onEdit: (commentId: string, text: string) => void | Promise<void>
  onDelete: (commentId: string) => void | Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()
  const [reply, setReply] = useState('')
  const inputRef = useGrowingTextarea(reply)
  const { busy, failed, run } = useCommentRequest()
  const submit = () => { if (reply.trim()) void run(() => onReply(reply), () => setReply('')) }
  return <>
    <CommentHeader onClose={onClose} />
    {thread.anchor.text && <div className="comment-thread-quote"><CommentQuote text={thread.anchor.text} /></div>}
    {notice && <div className="comment-notice">{notice}</div>}
    <div className="comment-messages">{thread.comments.map(comment => <CommentRow key={comment.id} comment={comment} canEdit={!readOnly && (isOwner || comment.author === authEmail)} onEdit={text => onEdit(comment.id, text)} onDelete={() => onDelete(comment.id)} />)}</div>
    {!readOnly && <div className="comment-reply">
      <fieldset className="comment-input-shell" disabled={busy}>
        <MentionTextarea inputRef={inputRef} value={reply} onChange={setReply} options={memberMentionOptions(members)} onSubmit={submit} rows={1} placeholder={t('comment.replyPlaceholder')} submitHint={t('comment.replyLabel')} className="comment-textarea" />
        <div className="comment-input-actions"><button type="button" onClick={submit} disabled={!reply.trim() || busy} className="comment-send" aria-label={t('comment.reply')} title={t('comment.reply')} aria-busy={busy}>{busy ? <RefreshDouble width={15} height={15} className="motion-safe:animate-spin" aria-hidden="true" /> : <SendDiagonal width={15} height={15} aria-hidden="true" />}</button></div>
      </fieldset>
      <CommentError failed={failed} />
    </div>}
  </>
}

export function CommentListPopover({ threads, onPick, onClose, anchorRef, outsideIgnore }: {
  threads: CommentThread[]
  onPick: (thread: CommentThread, at: { x: number; y: number }) => void
  onClose: () => void
  anchorRef?: RefObject<HTMLButtonElement | null>
  outsideIgnore?: () => Element | null
}) {
  const { formatDate, t } = useI18n()
  return <CommentPopover x={0} y={0} onClose={onClose} label={t('comment.listTitle')} anchorRef={anchorRef} outsideIgnore={outsideIgnore}>
    <CommentHeader count={threads.length} onClose={onClose} />
    <div className="comment-list">
      {threads.length === 0 && <div className="comment-empty"><ChatBubble width={20} height={20} aria-hidden="true" /><span>{t('comment.none')}</span></div>}
      {threads.map(thread => {
        const first = thread.comments[0]
        if (!first) return null
        return <button key={thread.id} type="button" onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect()
          onPick(thread, { x: rect.left, y: rect.bottom })
        }} className="comment-list-item">
          <CommentAvatar author={first.author} />
          <span className="comment-list-main">
            <span className="comment-meta"><span className="comment-author">{first.author.split('@')[0] || first.author}</span><span className="comment-time">{formatDate(first.time, { month: 'numeric', day: 'numeric' })}</span>{thread.comments.length > 1 && <span className="comment-reply-count">{t('comment.replyCount', { count: thread.comments.length - 1 })}</span>}</span>
            <span className="comment-list-body">{first.text}</span>
            {thread.anchor.text && <span className="comment-list-quote">{thread.anchor.text}</span>}
          </span>
        </button>
      })}
    </div>
  </CommentPopover>
}
