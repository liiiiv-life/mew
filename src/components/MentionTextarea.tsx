import { canAutoFocusInput } from '@mew/ui'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type CSSProperties, type RefObject } from 'react'
import { AgentComposerInput, type MentionInputHandle } from './agent-composer-input'
import { clipboardImages } from '../utils/clipboard-images'
import { prefixMatch } from '@mew/editor'
import { useOverlayDismiss } from '@mew/ui'

// '@' 멘션이 되는 textarea — 채팅 입력(파일 멘션)과 댓글 작성(사용자 멘션)이 같이 쓴다.
// '@' 뒤에 이어 친 글자를 검색어로 목록을 띄우고, 고르면 '@검색어'가 insert 문자열로 바뀐다.
// 에이전트에서는 모바일 이미지 입력을 위해 CodeMirror 편집 호스트를 사용한다.

export interface MentionOption {
  id: string
  label: string
  /** 목록에서 이름 옆에 흐리게 붙는 부가 정보(경로 등) */
  hint?: string
  /** 골랐을 때 '@검색어' 자리에 들어갈 문자열 */
  insert: string
  /** 삽입 뒤에 붙일 구분자. 기본은 다음 말을 이어 쓸 공백 하나다. */
  insertSuffix?: string
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
  onFilesDropped,
  onImagesPasted,
  onOptionSelect,
  inputRef,
  onHistoryNavigate,
  maxResults = 8,
  onTriggerChange,
  imageCapable = false,
}: {
  value: string
  onChange: (value: string) => void
  options: MentionOption[]
  /** 스크롤로 모든 후보를 고를 수 있게 하려면 Infinity를 전달한다. */
  maxResults?: number
  /** Let callers load additional candidates only while a trigger is open. */
  onTriggerChange?: (trigger: string | null) => void
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
  /** 운영체제 파일을 입력칸에 놓았을 때 받는다. 텍스트 드래그는 기존처럼 무시한다. */
  onFilesDropped?: (files: File[]) => void
  /** 이미지 클립보드를 붙여넣었을 때 받는다. 일반 텍스트 붙여넣기는 그대로 textarea가 처리한다. */
  onImagesPasted?: (files: File[]) => void
  /** 선택된 멘션의 부수 동작(예: 에이전트 탭 이름)을 호출한다. */
  onOptionSelect?: (option: MentionOption) => void
  /** 호스트가 모바일 보조키 등으로 입력 커서를 조작할 때 쓴다. */
  inputRef?: RefObject<MentionInputHandle | null>
  /** Rich editing host lets mobile keyboards offer image clipboard entries. */
  imageCapable?: boolean
  /** 호스트가 첫·마지막 시각적 줄인지 확인해 입력 히스토리를 탐색한다. 처리했으면 true를 돌린다. */
  onHistoryNavigate?: (direction: 'up' | 'down') => boolean
}) {
  const ownTextareaRef = useRef<MentionInputHandle>(null)
  const textareaRef = inputRef ?? ownTextareaRef
  const optionSets = useMemo<TriggerOptionSet[]>(() => [{ trigger: '@', options }, ...(triggers ?? [])], [options, triggers])
  const triggerChars = useMemo(() => optionSets.map((set) => set.trigger), [optionSets])
  const [mention, setMention] = useState<{ trigger: string; from: number; query: string } | null>(null)
  const [selected, setSelected] = useState(0)
  const [fileDragOver, setFileDragOver] = useState(false)
  const selectedOptionRef = useRef<HTMLButtonElement>(null)
  const activeTrigger = mention?.trigger ?? null
  useEffect(() => { onTriggerChange?.(activeTrigger) }, [activeTrigger, onTriggerChange])

  const closeMention = () => {
    setMention(null)
    setSelected(0)
  }

  const shown = useMemo(() => {
    if (!mention) return []
    const activeOptions = optionSets.find((set) => set.trigger === mention.trigger)?.options ?? []
    return activeOptions
      .filter((option) => prefixMatch(mention.query, option.label))
      .sort((a, b) => {
        // 인라인 자동완성은 입력으로 시작하는 후보만 보인다. 유형 우선순위가 있는 @ 목록은
        // 프로젝트 → 폴더 → 파일을 유지하고, 같은 종류 및 일반 멘션은 가나다순으로 정렬한다.
        if (a.sortPriority !== undefined || b.sortPriority !== undefined) {
          const aPriority = a.sortPriority ?? Number.MAX_SAFE_INTEGER
          const bPriority = b.sortPriority ?? Number.MAX_SAFE_INTEGER
          if (aPriority !== bPriority) return aPriority - bPriority
        }
        return a.label.localeCompare(b.label, 'ko-KR') || a.id.localeCompare(b.id, 'ko-KR')
      })
      .slice(0, maxResults)
  }, [mention, optionSets, maxResults])

  useEffect(() => {
    selectedOptionRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected, shown])

  const syncMention = (next: string, caret: number) => {
    const found = mentionQueryAt(next, caret, triggerChars)
    setMention(found)
    if (!found || found.trigger !== mention?.trigger || found.query !== mention?.query) setSelected(0)
  }

  // 인라인 검색 메뉴도 모달·패널과 같은 Esc 스택에 올라간다. 기본 capture 단계가 툴팁을
  // 먼저 닫고 이벤트를 소비하므로, 아래의 에이전트·채팅 같은 bubble 패널까지 닫히지 않는다.
  useOverlayDismiss(mention && (shown.length > 0 || onTriggerChange) ? closeMention : false)

  const pick = (option: MentionOption) => {
    if (!mention) return
    const el = textareaRef.current
    const caret = el?.selectionStart ?? value.length
    const suffix = option.insertSuffix ?? ' '
    const next = value.slice(0, mention.from) + option.insert + suffix + value.slice(caret)
    onChange(next)
    onOptionSelect?.(option)
    closeMention()
    requestAnimationFrame(() => {
      const pos = mention.from + option.insert.length + suffix.length
      el?.setSelectionRange(pos, pos)
      el?.focus()
    })
  }

  const handleKeyDown = (e: KeyboardEvent | ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && shown.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSelected((s) => (s + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length)
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !('nativeEvent' in e ? e.nativeEvent.isComposing : e.isComposing)) {
        e.preventDefault()
        pick(shown[selected] ?? shown[0])
        return
      }
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (onHistoryNavigate?.(e.key === 'ArrowUp' ? 'up' : 'down')) {
        e.preventDefault()
        return
      }
    }
    const shouldSubmit =
      submitShortcut === 'enter'
        ? e.key === 'Enter' && !e.shiftKey
        : e.key === 'Enter' && (e.ctrlKey || e.metaKey)
    if (shouldSubmit && !('nativeEvent' in e ? e.nativeEvent.isComposing : e.isComposing) && onSubmit) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div
      className={`relative min-w-0 flex-1 ${imageCapable ? 'min-h-0' : ''} ${fileDragOver ? 'rounded-lg ring-1 ring-accent' : ''}`}
      onDragEnter={(event) => {
        if (!onFilesDropped || !event.dataTransfer.types.includes('Files')) return
        setFileDragOver(true)
      }}
      onDragOver={(event) => {
        if (!onFilesDropped || !event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setFileDragOver(false)
      }}
      onDrop={(event) => {
        if (!onFilesDropped || !event.dataTransfer.files.length) return
        event.preventDefault()
        setFileDragOver(false)
        onFilesDropped(Array.from(event.dataTransfer.files))
      }}
    >
      {mention && shown.length > 0 && (
        <div className="absolute bottom-full left-0 z-40 mb-1 max-h-56 min-w-[14rem] max-w-full overflow-y-auto rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl">
          {shown.map((option, i) => (
            <button
              key={option.id}
              ref={i === selected ? selectedOptionRef : undefined}
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
      {imageCapable ? <AgentComposerInput
        value={value}
        onChange={(next, caret) => {
          if (next !== value) onChange(next)
          syncMention(next, caret)
        }}
        onKeyDown={handleKeyDown}
        onImagesPasted={onImagesPasted}
        inputRef={textareaRef}
        placeholder={placeholder}
        label={submitHint}
        autoFocus={autoFocus && canAutoFocusInput()}
        className={className}
        style={style}
      /> : <textarea
        ref={(element) => { textareaRef.current = element }}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus && canAutoFocusInput()}
        rows={rows}
        aria-label={submitHint}
        onChange={(e) => {
          onChange(e.target.value)
          syncMention(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }}
        onClick={(e) => syncMention(value, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onPaste={(event) => {
          if (!onImagesPasted) return
          const files = clipboardImages(event.clipboardData)
          if (!files.length) return
          event.preventDefault()
          onImagesPasted(files)
        }}
        onKeyDown={handleKeyDown}
        style={style}
        className={
          className ??
          'w-full resize-none rounded-lg border border-edge bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-edge-bright'
        }
      />}
    </div>
  )
}
