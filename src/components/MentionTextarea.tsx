import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { fuzzyScore } from '@mew/editor'

// '@' 멘션이 되는 textarea — 채팅 입력(파일 멘션)과 댓글 작성(사용자 멘션)이 같이 쓴다.
// '@' 뒤에 이어 친 글자를 검색어로 목록을 띄우고, 고르면 '@검색어'가 insert 문자열로 바뀐다.
// 에디터의 멘션(트랜잭션 기반)과 달리 여기는 평범한 textarea라 keydown으로 충분하다.

export interface MentionOption {
  id: string
  label: string
  /** 목록에서 이름 옆에 흐리게 붙는 부가 정보(경로 등) */
  hint?: string
  /** 골랐을 때 '@검색어' 자리에 들어갈 문자열 */
  insert: string
}

export interface TriggerOptionSet {
  trigger: string
  options: MentionOption[]
}

/** 멤버 이메일 → 멘션 옵션 — 넣는 문자열이 `@이메일` 그대로여야 서버가 멘션으로 알아본다(server/chat.ts) */
export function memberMentionOptions(members: string[]): MentionOption[] {
  return members.map((email) => ({ id: email, label: email.split('@')[0] || email, hint: email, insert: `@${email}` }))
}

/** 커서 앞의 트리거+검색어 — 트리거가 줄 처음이나 공백 뒤에 있을 때만 멘션으로 본다 */
function mentionQueryAt(value: string, caret: number, triggers: string[]): { trigger: string; from: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i]
    if (triggers.includes(ch)) {
      if (i > 0 && !/\s/.test(value[i - 1])) return null
      return { trigger: ch, from: i, query: value.slice(i + 1, caret) }
    }
    if (/\s/.test(ch)) return null
  }
  return null
}

export function MentionTextarea({
  value,
  onChange,
  options,
  onSubmit,
  placeholder,
  autoFocus,
  rows = 1,
  className,
  style,
  submitHint,
  triggers,
  submitShortcut = 'enter',
}: {
  value: string
  onChange: (value: string) => void
  options: MentionOption[]
  /** 메뉴가 닫혀 있을 때 Enter(Shift 없이) — 채팅 전송·댓글 등록 */
  onSubmit?: () => void
  placeholder?: string
  autoFocus?: boolean
  rows?: number
  className?: string
  style?: CSSProperties
  /** 자리표시자 아래가 아니라 접근성 라벨로만 쓰는 설명 */
  submitHint?: string
  /** 기본 '@' 외에 '/' 같은 트리거를 추가한다. */
  triggers?: TriggerOptionSet[]
  submitShortcut?: 'enter' | 'mod-enter'
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const optionSets = useMemo<TriggerOptionSet[]>(() => [{ trigger: '@', options }, ...(triggers ?? [])], [options, triggers])
  const triggerChars = useMemo(() => optionSets.map((set) => set.trigger), [optionSets])
  const [mention, setMention] = useState<{ trigger: string; from: number; query: string } | null>(null)
  const [selected, setSelected] = useState(0)

  const shown = useMemo(() => {
    if (!mention) return []
    const activeOptions = optionSets.find((set) => set.trigger === mention.trigger)?.options ?? []
    const query = mention.query.toLowerCase()
    return activeOptions
      .map((option) => ({ option, score: fuzzyScore(mention.query, option.label) }))
      .filter((x): x is { option: MentionOption; score: number } => x.score !== null)
      .sort((a, b) => {
        const aStarts = a.option.label.toLowerCase().startsWith(query)
        const bStarts = b.option.label.toLowerCase().startsWith(query)
        if (aStarts !== bStarts) return aStarts ? -1 : 1
        return b.score - a.score
      })
      .slice(0, 8)
      .map((x) => x.option)
  }, [mention, optionSets])

  const syncMention = (next: string, caret: number) => {
    const found = mentionQueryAt(next, caret, triggerChars)
    setMention(found)
    if (!found) setSelected(0)
  }

  const pick = (option: MentionOption) => {
    if (!mention) return
    const el = textareaRef.current
    const caret = el?.selectionStart ?? value.length
    const next = value.slice(0, mention.from) + option.insert + ' ' + value.slice(caret)
    onChange(next)
    setMention(null)
    setSelected(0)
    requestAnimationFrame(() => {
      const pos = mention.from + option.insert.length + 1
      el?.setSelectionRange(pos, pos)
      el?.focus()
    })
  }

  return (
    <div className="relative min-w-0 flex-1">
      {mention && shown.length > 0 && (
        <div className="absolute bottom-full left-0 z-40 mb-1 max-h-56 min-w-[14rem] max-w-full overflow-y-auto rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl">
          {shown.map((option, i) => (
            <button
              key={option.id}
              type="button"
              // textarea의 blur보다 먼저 잡아야 한다 — mousedown에서 고르고 기본 동작(포커스 이탈)을 막는다
              onMouseDown={(e) => {
                e.preventDefault()
                pick(option)
              }}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
                i === selected ? 'bg-surface-hover text-ink' : 'text-ink-secondary hover:bg-surface-hover'
              }`}
            >
              <span className="truncate">{option.label}</span>
              {option.hint && <span className="min-w-0 flex-1 truncate text-right text-ink-faint">{option.hint}</span>}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={rows}
        aria-label={submitHint}
        onChange={(e) => {
          onChange(e.target.value)
          syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }}
        onClick={(e) => syncMention(value, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (mention && shown.length > 0) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((s) => (s + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length)
              return
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
              e.preventDefault()
              pick(shown[selected] ?? shown[0])
              return
            }
            if (e.key === 'Escape') {
              // 패널·팝업까지 닫히지 않게 여기서 끊는다 — 멘션 목록만 닫는다
              e.preventDefault()
              e.stopPropagation()
              setMention(null)
              return
            }
          }
          const shouldSubmit =
            submitShortcut === 'enter'
              ? e.key === 'Enter' && !e.shiftKey
              : e.key === 'Enter' && (e.ctrlKey || e.metaKey)
          if (shouldSubmit && !e.nativeEvent.isComposing && onSubmit) {
            e.preventDefault()
            onSubmit()
          }
        }}
        style={style}
        className={
          className ??
          'w-full resize-none rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-edge-bright'
        }
      />
    </div>
  )
}
