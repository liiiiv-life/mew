import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import type { CommentEntry, CommentThread } from '../api/client'
import { identityColor } from '../utils/collabColor'
import { MentionTextarea, memberMentionOptions } from './MentionTextarea'
import { useI18n } from '../i18n'

// 파일 댓글 팝업들 — 작성(Alt+Shift+C)·스레드 보기(하이라이트 클릭)·목록(도구 줄 버튼).
// 전부 EditorPane이 띄우고, 저장·삭제는 EditorPane이 서버로 보낸다(여기는 화면만).

/** 화면 좌표 (x, y) 아래에 뜨는 카드 — 화면 밖으로 나가지 않게 뜬 뒤 자리를 다듬는다 */
export function CommentPopover({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y + 8 })
  // 바깥을 눌러도 닫힌다 — 폰에는 Esc가 없다
  useOverlayDismiss(onClose, { outside: () => ref.current })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y + 8, window.innerHeight - rect.height - 8)),
    })
  }, [x, y])
  return (
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-50 flex w-[19rem] max-w-[calc(100vw-1rem)] flex-col rounded-lg border border-edge-bright bg-surface-raised shadow-xl"
      // 팝업 안 클릭이 에디터로 흘러 포커스·선택이 풀리지 않게
      onPointerDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

/** 새 스레드 작성 — 선택 텍스트 미리보기 한 줄 + 입력창 */
export function CommentComposer({
  quote,
  members,
  onSubmit,
  onClose,
}: {
  quote: string
  members: string[]
  onSubmit: (text: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [text, setText] = useState('')
  const submit = () => {
    if (!text.trim()) return
    onSubmit(text)
  }
  return (
    <div className="flex flex-col gap-2 p-2.5">
      {quote && (
        <div className="truncate border-l-2 border-[color-mix(in_srgb,#eab308_70%,transparent)] pl-2 text-xs text-ink-muted">{quote}</div>
      )}
      <MentionTextarea
        value={text}
        onChange={setText}
        options={memberMentionOptions(members)}
        onSubmit={submit}
        rows={2}
        autoFocus
        placeholder={t('comment.inputPlaceholder')}
        submitHint={t('comment.submitHint')}
      />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover">
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="rounded bg-accent px-2.5 py-1 text-xs text-ink-on-accent disabled:opacity-40"
        >
          {t('comment.add')}
        </button>
      </div>
    </div>
  )
}

function CommentRow({
  comment,
  canEdit,
  onEdit,
  onDelete,
}: {
  comment: CommentEntry
  canEdit: boolean
  onEdit: (text: string) => void
  onDelete: () => void
}) {
  const { formatDate, t } = useI18n()
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <div className="group px-2.5 py-1.5">
      <div className="flex items-baseline gap-1.5">
        <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ backgroundColor: identityColor(comment.author) }} />
        <span className="truncate text-xs font-medium text-ink-secondary">{comment.author.split('@')[0] || comment.author}</span>
        <span className="shrink-0 text-[10px] text-ink-faint">
          {formatDate(comment.time, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {comment.edited ? ` · ${t('comment.edited')}` : ''}
        </span>
        {canEdit && editing === null && (
          // 터치 화면에는 hover가 없다 — 손가락으로는 영영 안 뜨므로 coarse 포인터에선 항상 보인다
          <span className="ml-auto hidden shrink-0 gap-0.5 group-hover:flex pointer-coarse:flex">
            <button
              type="button"
              onClick={() => setEditing(comment.text)}
              className="rounded p-0.5 text-ink-muted hover:bg-surface-hover hover:text-ink"
              aria-label={t('comment.edit')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded p-0.5 text-ink-muted hover:bg-surface-hover hover:text-danger"
              aria-label={t('comment.delete')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </span>
        )}
      </div>
      {editing === null ? (
        <div className="select-text whitespace-pre-wrap break-words pl-3.5 text-sm text-ink">{comment.text}</div>
      ) : (
        <div className="flex flex-col gap-1.5 pl-3.5">
          <textarea
            autoFocus
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setEditing(null)
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (editing.trim()) onEdit(editing)
                setEditing(null)
              }
            }}
            rows={2}
            className="w-full resize-none rounded border border-edge bg-surface px-2 py-1 text-sm text-ink outline-none"
            aria-label={t('comment.editInput')}
          />
          {/* Enter·Esc만으로는 폰에서 저장도 취소도 할 수 없다 */}
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (editing.trim()) onEdit(editing)
                setEditing(null)
              }}
              disabled={!editing.trim()}
              className="rounded bg-accent px-2.5 py-1 text-xs text-ink-on-accent disabled:opacity-40"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 스레드 하나 — 댓글 목록 + 답글 입력. 같은 자리에 댓글을 계속 이어 달 수 있다 */
export function CommentThreadView({
  thread,
  authEmail,
  isOwner,
  members,
  notice,
  onReply,
  onEdit,
  onDelete,
  onClose,
}: {
  thread: CommentThread
  authEmail: string | null
  isOwner: boolean
  members: string[]
  /** 본문에서 자리를 못 찾았을 때의 안내 — 스크롤이 안 된 이유를 사람이 볼 수 있어야 한다 */
  notice?: string
  onReply: (text: string) => void
  onEdit: (commentId: string, text: string) => void
  onDelete: (commentId: string) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [reply, setReply] = useState('')
  const submit = () => {
    if (!reply.trim()) return
    onReply(reply)
    setReply('')
  }
  return (
    <div className="flex max-h-[24rem] flex-col">
      {/* 닫기 버튼은 앵커 문구가 없어도 늘 있어야 한다 — 폰에는 Esc가 없다 */}
      <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
          {thread.anchor.text && (
            <span className="rounded bg-[color-mix(in_srgb,#eab308_30%,transparent)] px-1">{thread.anchor.text.slice(0, 80)}</span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 shrink-0 rounded p-1 text-ink-muted hover:bg-surface-hover hover:text-ink"
          aria-label={t('comment.close')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      {notice && <div className="border-b border-edge bg-surface-deep px-2.5 py-1.5 text-[11px] leading-snug text-ink-muted">{notice}</div>}
      <div className="min-h-0 flex-1 divide-y divide-edge overflow-y-auto">
        {thread.comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            canEdit={isOwner || comment.author === authEmail}
            onEdit={(text) => onEdit(comment.id, text)}
            onDelete={() => onDelete(comment.id)}
          />
        ))}
      </div>
      {/* 등록 버튼이 있어야 한다 — 폰 자판의 Enter는 줄바꿈이라 답글이 영영 안 올라간다 */}
      <div className="flex flex-col gap-1.5 border-t border-edge p-2">
        <MentionTextarea
          value={reply}
          onChange={setReply}
          options={memberMentionOptions(members)}
          onSubmit={submit}
          rows={1}
          placeholder={t('comment.replyPlaceholder')}
          submitHint={t('comment.submitHint')}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!reply.trim()}
          className="self-end rounded bg-accent px-2.5 py-1 text-xs text-ink-on-accent disabled:opacity-40"
        >
          {t('comment.reply')}
        </button>
      </div>
    </div>
  )
}

/** 이 파일의 모든 스레드 목록 — 목차 버튼 왼쪽 플로팅 버튼이 띄운다. 고르면 그 자리로 점프 */
export function CommentListPopover({
  threads,
  onPick,
  onClose,
}: {
  threads: CommentThread[]
  /** 누른 화면 좌표를 같이 준다 — 본문에서 자리를 못 찾으면 거기에 팝업을 띄운다 */
  onPick: (thread: CommentThread, at: { x: number; y: number }) => void
  onClose: () => void
}) {
  const { formatDate, t } = useI18n()
  useOverlayDismiss(onClose)
  return (
    <div
      className="absolute right-0 top-full z-40 mt-1 flex max-h-[22rem] w-[19rem] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {threads.length === 0 && <div className="px-3 py-4 text-center text-xs text-ink-muted">{t('comment.none')}</div>}
      {threads.map((thread) => {
        const first = thread.comments[0]
        if (!first) return null
        return (
          <button
            key={thread.id}
            type="button"
            onClick={(e) => onPick(thread, { x: e.clientX, y: e.clientY })}
            className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-surface-hover"
          >
            <span className="flex w-full items-baseline gap-1.5">
              <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ backgroundColor: identityColor(first.author) }} />
              <span className="truncate text-xs font-medium text-ink-secondary">{first.author.split('@')[0] || first.author}</span>
              <span className="shrink-0 text-[10px] text-ink-faint">{formatDate(first.time, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              {thread.comments.length > 1 && (
                <span className="ml-auto shrink-0 text-[10px] text-ink-muted">{t('comment.replyCount', { count: thread.comments.length - 1 })}</span>
              )}
            </span>
            {thread.anchor.text && <span className="w-full truncate pl-3.5 text-[11px] text-ink-muted">“{thread.anchor.text.slice(0, 60)}”</span>}
            <span className="w-full truncate pl-3.5 text-xs text-ink">{first.text}</span>
          </button>
        )
      })}
    </div>
  )
}
