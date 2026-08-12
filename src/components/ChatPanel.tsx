import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flattenFiles } from '@mew/editor'
import { useSwipeGesture } from '@mew/mobile-keys'
import {
  fetchChat,
  fetchMembers,
  markChatRead,
  postChat,
  GROUP_CHAT,
  type ChatMessage,
  type ChatView,
  type TreeNode,
} from '../api/client'
import { identityColor } from '../utils/collabColor'
import { MentionTextarea, type MentionOption } from './MentionTextarea'

// 멤버 간 채팅 창 (Alt+C) — 단체방 하나 + 사람마다 1:1 DM. 저장·전달은 서버(REST)가 하고,
// 새 메시지 신호는 presence의 {type:'chat'}을 usePresence가 window 'mew:signal'로 흘려 준 것을 받는다.
//
// 왼쪽 줄에 대화가 선다: 맨 위가 단체방, 그 아래가 나를 뺀 멤버들이다. 서버는 내가 볼 수 있는
// 메시지를 한 번에 주고(남의 DM은 실리지도 않는다), 이 화면이 대화별로 갈라 그린다.
//
// 읽음 숫자는 서버가 메시지마다 세어 준 "아직 안 읽은 수신자 수"다(ADR 0050). 0이면 감춘다.
//
// 파일 멘션: 입력창에서 '@'를 치면 지금 프로젝트의 파일 목록이 뜨고, 고르면 `[[프로젝트:경로]]`
// 토큰이 들어간다. 메시지에서는 경로 대신 **파일 이름 칩**으로 그려지고, 누르면 그 파일이
// 같은 창의 에디터 탭으로 열린다(다른 프로젝트면 프로젝트도 같이 전환).

/** 이 메시지가 그 대화에 속하는가 — 서버 conversationsOf와 같은 규칙이다 */
function inConversation(message: ChatMessage, me: string | null, conversation: string): boolean {
  if (!message.to || message.to.length === 0) return conversation === GROUP_CHAT
  if (conversation === GROUP_CHAT) return false
  return message.author === me ? message.to.includes(conversation) : message.author === conversation
}

/** 이메일에서 화면에 쓸 이름 — @앞 부분 */
function shortName(email: string): string {
  return email.split('@')[0] || email
}

/** `[[프로젝트:상대경로]]` — 첫 ':'까지가 프로젝트다(프로젝트 이름에는 ':'가 올 수 없다) */
function parseFileToken(inner: string): { project: string; path: string } | null {
  const idx = inner.indexOf(':')
  if (idx <= 0 || idx === inner.length - 1) return null
  return { project: inner.slice(0, idx), path: inner.slice(idx + 1) }
}

function fileTitle(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function formatTime(time: number): string {
  const d = new Date(time)
  const today = new Date().toDateString() === d.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return today ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/** 본문을 파일 멘션 칩과 일반 텍스트로 나눠 그린다 */
function MessageBody({ text, onOpenFile }: { text: string; onOpenFile: (project: string, path: string) => void }) {
  const parts = text.split(/(\[\[[^\]\n]+\]\])/)
  return (
    <div className="whitespace-pre-wrap break-words text-sm text-ink">
      {parts.map((part, i) => {
        const inner = part.startsWith('[[') && part.endsWith(']]') ? part.slice(2, -2) : null
        const token = inner ? parseFileToken(inner) : null
        if (!token) return <span key={i}>{part}</span>
        return (
          <button
            key={i}
            type="button"
            onClick={() => onOpenFile(token.project, token.path)}
            title={`${token.project}/${token.path}`}
            className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded bg-surface-raised px-1.5 py-0.5 align-baseline text-xs text-link hover:bg-surface-hover"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            <span className="truncate">{fileTitle(token.path)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 안 읽은 수 뱃지 — 아이콘 오른쪽 위에 붙는다. 0이면 부르는 쪽에서 그리지 않는다 */
function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium leading-none text-white">
      {count > 99 ? '99+' : count}
    </span>
  )
}

/** 왼쪽 줄의 대화 하나 — 맨 위 단체방, 아래로 멤버들. 호버하면 이름이 뜬다 */
function ConversationIcon({
  label,
  title,
  color,
  active,
  unread,
  children,
  onClick,
}: {
  label: string
  title: string
  color?: string
  active: boolean
  unread: number
  children?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-current={active}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white transition ${
        active ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-deep' : 'opacity-70 hover:opacity-100'
      }`}
      style={color ? { backgroundColor: color } : undefined}
    >
      {children ?? label}
      {unread > 0 && <UnreadBadge count={unread} />}
    </button>
  )
}

function GroupGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

export function ChatPanel({
  authEmail,
  project,
  tree,
  onOpenFile,
  onClose,
}: {
  authEmail: string | null
  project: string
  tree: TreeNode[]
  onOpenFile: (project: string, path: string) => void
  onClose: () => void
}) {
  const [view, setView] = useState<ChatView>({ messages: [], unread: {}, dmSupported: true })
  const [members, setMembers] = useState<string[]>([])
  /** 지금 보고 있는 대화 — GROUP_CHAT이거나 상대 이메일 */
  const [active, setActive] = useState<string>(GROUP_CHAT)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const refresh = useCallback(() => {
    fetchChat()
      .then((next) => {
        setView(next)
        setError(null)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '채팅을 불러오지 못했습니다'))
  }, [])

  // 대화 상대 목록 — 나는 뺀다. 자주 바뀌지 않아 창이 뜰 때 한 번만 읽는다
  useEffect(() => {
    if (!view.dmSupported) return
    fetchMembers()
      .then((list) => setMembers(list.filter((email) => email !== authEmail)))
      .catch(() => {})
  }, [authEmail, view.dmSupported])

  // 서버가 DM을 모르면 단체방으로 되돌린다 — 그대로 두면 보낸 글이 단체방에 뜬다
  useEffect(() => {
    if (!view.dmSupported && active !== GROUP_CHAT) setActive(GROUP_CHAT)
  }, [view.dmSupported, active])

  const messages = useMemo(
    () => view.messages.filter((message) => inConversation(message, authEmail, active)),
    [view.messages, authEmail, active],
  )

  // 보고 있는 대화는 읽은 것으로 표시한다 — 서버가 새로 읽은 게 없으면 방송하지 않으므로 여기서 멈춘다
  useEffect(() => {
    if ((view.unread[active] ?? 0) === 0) return
    markChatRead(active).catch(() => {})
  }, [view, active])

  useEffect(() => {
    refresh()
    // presence가 흘려 주는 새 메시지 신호 — 내용은 없으니 다시 읽는다
    const onSignal = (e: Event) => {
      if ((e as CustomEvent<{ type?: string }>).detail?.type === 'chat') refresh()
    }
    window.addEventListener('mew:signal', onSignal)
    return () => window.removeEventListener('mew:signal', onSignal)
  }, [refresh])

  // 맨 아래를 보고 있었으면 새 메시지에도 계속 맨 아래 — 위로 올려 읽는 중이면 건드리지 않는다
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // 에디터의 Ctrl+L — `경로:줄` 대신 이 창에서는 파일 멘션 토큰으로 받는다.
  // 창(App)이 마지막으로 연 보조창 하나를 골라 보내므로 채팅 차례일 때만 받는다
  useEffect(() => {
    const onInsertRef = (e: Event) => {
      const detail = (e as CustomEvent<{ target?: string; project?: string; path?: string }>).detail
      if (detail?.target !== 'chat') return
      if (detail.project && detail.path) setDraft((d) => `${d}[[${detail.project}:${detail.path}]] `)
    }
    window.addEventListener('mew:insert-ref', onInsertRef)
    return () => window.removeEventListener('mew:insert-ref', onInsertRef)
  }, [])

  const mentionOptions = useMemo<MentionOption[]>(
    () =>
      flattenFiles(tree).map((path) => ({
        id: path,
        label: path.split('/').pop() ?? path,
        hint: path,
        insert: `[[${project}:${path}]]`,
      })),
    [tree, project],
  )

  const send = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    postChat(text, active === GROUP_CHAT ? undefined : [active])
      .then(refresh)
      .catch((err) => {
        setDraft(text) // 실패한 입력을 버리지 않는다
        setError(err instanceof Error ? err.message : '전송하지 못했습니다')
      })
  }

  // 아래 20% 좌→우 스와이프로 닫기 — 오른쪽에 붙은 창을 밀어내는 손짓(터미널·에이전트와 같다)
  const swipe = useSwipeGesture({ onBottomRight: onClose })

  const rail = (
    <div className="flex w-12 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-edge py-2">
      <ConversationIcon
        label="전체"
        title="단체 대화방"
        active={active === GROUP_CHAT}
        unread={view.unread[GROUP_CHAT] ?? 0}
        onClick={() => setActive(GROUP_CHAT)}
      >
        <span className="text-ink-secondary">
          <GroupGlyph />
        </span>
      </ConversationIcon>
      <div className="h-px w-6 shrink-0 bg-edge" aria-hidden="true" />
      {!view.dmSupported && (
        <span className="px-1 text-center text-[9px] leading-tight text-ink-faint" title="서버를 다시 띄우면 개인 대화가 열린다">
          서버
          <br />
          재시작
          <br />
          필요
        </span>
      )}
      {members.map((email) => (
        <ConversationIcon
          key={email}
          label={shortName(email).slice(0, 2).toUpperCase()}
          title={`${shortName(email)} · ${email}`}
          color={identityColor(email)}
          active={active === email}
          unread={view.unread[email] ?? 0}
          onClick={() => setActive(email)}
        />
      ))}
    </div>
  )

  const title = active === GROUP_CHAT ? '단체 대화방' : shortName(active)

  return (
    <div className="flex h-full w-full bg-surface-deep" {...swipe}>
      {rail}
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge px-2">
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
          aria-label="채팅 닫기"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{title}</span>
        <span className="shrink-0 text-[10px] text-ink-muted">Alt+C</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        {messages.length === 0 && !error && (
          <div className="py-8 text-center text-xs text-ink-muted">
            {active === GROUP_CHAT ? '아직 메시지가 없습니다' : `${shortName(active)}님과 나눈 대화가 없습니다`} — @로 파일을 멘션할 수 있습니다
          </div>
        )}
        {messages.map((message, i) => {
          const prev = messages[i - 1]
          // 같은 사람이 5분 안에 이어 보내면 머리(이름·시간)를 생략한다
          const compact = prev && prev.author === message.author && message.time - prev.time < 5 * 60 * 1000
          return (
            <div key={message.id} className={compact ? 'mt-0.5 pl-4' : 'mt-3 first:mt-0'}>
              {!compact && (
                <div className="mb-0.5 flex items-baseline gap-1.5">
                  <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ backgroundColor: identityColor(message.author) }} />
                  <span className={`truncate text-xs font-medium ${message.author === authEmail ? 'text-ink' : 'text-ink-secondary'}`}>
                    {message.author.split('@')[0] || message.author}
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-faint">{formatTime(message.time)}</span>
                </div>
              )}
              {/* 안 읽은 수신자 수 — 카톡처럼 버블 옆에 붙고, 모두 읽으면 사라진다 */}
              <div className={`flex items-start gap-1.5 ${compact ? '' : 'pl-3.5'}`}>
                <div className="min-w-0 flex-1">
                  <MessageBody text={message.text} onOpenFile={onOpenFile} />
                </div>
                {message.unread > 0 && (
                  <span
                    className="shrink-0 pt-0.5 text-[10px] font-medium text-accent"
                    title={`${message.unread}명이 아직 안 읽음`}
                  >
                    {message.unread}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {error && <div className="border-t border-edge px-3 py-1 text-xs text-danger">{error}</div>}

      <div className="flex shrink-0 items-end gap-2 border-t border-edge p-2">
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          options={mentionOptions}
          onSubmit={send}
          rows={2}
          placeholder={active === GROUP_CHAT ? '메시지 입력 — @파일 멘션 · Ctrl+L 현재 위치' : `${shortName(active)}님에게 — @파일 멘션`}
          submitHint="Enter로 전송"
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-ink-on-accent disabled:opacity-40"
          aria-label="전송"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 2-7 20-4-9-9-4z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
      </div>
      </div>
    </div>
  )
}
