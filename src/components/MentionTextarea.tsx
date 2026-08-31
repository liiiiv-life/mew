import { useMemo, useRef, useState, type CSSProperties } from 'react'
import { fuzzyScore } from '@mew/editor'
import { useOverlayDismiss } from '@mew/ui'

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
  /** 같은 트리거 안에서 고정 우선순위로 정렬할 때 쓰는 낮은 숫자. */
  sortPriority?: number
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

  const closeMention = () => {
    setMention(null)
    setSelected(0)
  }

  const shown = useMemo(() => {
    if (!mention) return []
    const activeOptions = optionSets.find((set) => set.trigger === mention.trigger)?.options ?? []
    return activeOptions
      .map((option) => ({ option, score: fuzzyScore(mention.query, option.label) }))
      .filter((x): x is { option: MentionOption; score: number } => x.score !== null)
      .sort((a, b) => {
        // 유형 우선순위를 준 목록(@의 하위 프로젝트·폴더·파일 등)은 검색 점수보다
        // 우선순위와 가나다순이 결과의 기준이다. 기존 채팅·댓글 멘션은 계속 fuzzy 정렬한다.
        if (a.option.sortPriority !== undefined || b.option.sortPriority !== undefined) {
          const aPriority = a.option.sortPriority ?? Number.MAX_SAFE_INTEGER
          const bPriority = b.option.sortPriority ?? Number.MAX_SAFE_INTEGER
          if (aPriority !== bPriority) return aPriority - bPriority
          return a.option.label.localeCompare(b.option.label, 'ko-KR')
        }
        const query = mention.query.toLowerCase()
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

  // 인라인 검색 메뉴도 모달·패널과 같은 Esc 스택에 올라간다. 기본 capture 단계가 툴팁을
  // 먼저 닫고 이벤트를 소비하므로, 아래의 에이전트·채팅 같은 bubble 패널까지 닫히지 않는다.
  useOverlayDismiss(mention && shown.length > 0 ? closeMention : false)

  const pick = (option: MentionOption) => {
    if (!mention) return
    const el = textareaRef.current
    const caret = el?.selectionStart ?? value.length
    const next = value.slice(0, mention.from) + option.insert + ' ' + value.slice(caret)
    onChange(next)
    closeMention()
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
