import { PanelCloseButton } from './panel-close-button'
import { canAutoFocusInput } from '@mew/ui'
import { historyCacheKey, readHistoryCache, writeHistoryCache, readQueueCache, writeQueueCache, type CachedQueue, type CachedHistory } from '../utils/agent-history-cache'
import { mergeHistoryPage, appendHistoryEvent } from '../utils/agent-history-state'
import { PanelTitle } from './panel-title'
import type { AgentAttachmentInput } from '../../shared/agent-attachment'
import { panelModelState, splitCodexModelId } from '../../shared/codex-models'
import { WORKSPACE_PROJECT } from '../utils/active-project'
import { uiText, getUiLocale } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { createAgentNoticeTracker } from '../utils/mewcat-notification-rules'
import { publishMewcatNotice, resolveMewcatNotice } from '../utils/mewcat-notifications'
import { DockBody, DockGrip, DockInlineBody, DockPanel, useDock } from './DockWorkspace'
import { writeBrowserStorage } from '@mew/ui/browser-storage'
import { ServerDomBrowserTabs } from './server-dom-browser'
// 터미널•에이전트패널 — ACP 채팅과 탭별 tmux TUI·셸을 한 탭 체계에서 연다.
// **탭 하나가 세션 하나**다: 탭마다 자기 WS·자기 대화·서버 쪽 자식 프로세스를 하나씩 가진다.
// 대화 화면은 서버 이벤트에서 파생한다(접는 규칙은 utils/agentFold.ts). 브라우저 재진입 첫 화면은
// 탭별 이벤트 캐시가 그리고, 서버 replay가 오면 같은 세션의 최신 꼬리를 중복 없이 합친다.
// 정보줄(세션·토큰·턴 수)은 이벤트가 아니라 서버가 보내는 meta 스냅샷을 그대로 그린다.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type FormEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Terminal as TerminalIcon } from 'iconoir-react'
import { AgentCommandBubble, AgentCommandPopup } from './agent-command-bubble'
import { AgentLoadingBubbles } from './agent-loading-bubbles'
import { useAgentCommands } from '../hooks/use-agent-commands'
import { useScheduledPrompts } from '../hooks/use-scheduled-prompts'
import { stopAgentTabCommands } from '../api/agent-commands'
import { commandTimeline } from '../utils/agent-command-timeline'
import { copyText, keepFocusOnPress, useDragReorder, useOverlayDismiss } from '@mew/ui'
import { useFocusedShortcutScope } from '@mew/shortcuts'
import { TmuxTerminal } from '@mew/tmux-term'
import { useI18n } from '../i18n'
import { type TreeNode } from '@mew/editor'
import {
  agentMarkdownHrefFromClick,
  copyTextFromAgentMarkdownClick,
  isAgentWorkspaceHref,
  markAgentMarkdownCopied,
  renderMarkdown,
} from '../utils/agentMarkdown'
import { clearAgentInputDraft, readAgentInputDraft, readAgentInputHistory, recordAgentInputHistory, writeAgentInputDraft } from '../utils/agentInputDrafts'
import {
  clearAgentEventCache,
  clearAgentTabCaches,
  mergeAgentReplay,
  pruneAgentLocalCaches,
} from '../utils/agentEventCache'
import { DEFAULT_RUNTIME_ID, RUNTIMES, runtimeOf } from './agentRuntimes'
import {
  cancelAgentScheduledPrompt,
  fetchAgentDefault,
  fetchAgentAuthTerminalStatus,
  fetchAgentTabs,
  fetchAgentCwdSuggestions,
  fetchProjects,
  fetchFullTree,
  fetchSkills,
  installAgentRuntime,
  killTmuxSession,
  resolveAgentCwd,
  resolveAgentFileLink,
  rawUrl,
  runAgentAuthTerminal,
  openAgentAuthServerBrowser,
  openServerBrowserTab,
  closeServerBrowserTab,
  submitAgentAuthBrowserInput,
  saveAgentDefault,
  saveAgentTabs,
  scheduleAgentPrompt,
  startAgentTerminal,
  stopAgentTerminal,
  updateAgentScheduledPrompt,
  uploadInto,
  type AgentRuntimeDefault,
  type AgentRuntimeStatus,
  type AgentSessionClaim,
  type AgentCwdSuggestions,
  type ProjectInfo,
  type AgentSet,
  type AgentScheduledPrompt,
  type SkillSummary,
} from '../api/client'
import type { MentionInputHandle } from './agent-composer-input'
import { MentionTextarea, type MentionOption, type TriggerOptionSet } from './MentionTextarea'
import { agentInputMentionOptions } from '../utils/agentInputMentions'
import { SessionTerminalPopup } from './SessionTerminalPopup'
import { RuntimeSettingsButton } from './RuntimeSettingsModal'
import { AgentAccountCard } from './AgentAccountCard'
import { AgentQuotaBattery } from './AgentQuotaBattery'
import { AgentHarnessButtons } from './agent-harness-modal'
import { AgentGuidanceButton } from './agent-guidance-settings'
import { SUBSCRIPTION_URLS } from '../../shared/agent-access'
import { AgentSetPicker } from './AgentSetPicker'
import { ScrollDateTimePicker } from './ScrollDateTimePicker'
import { cachedAgentRuntimes, refreshAgentRuntimes, subscribeAgentRuntimes, updateAgentRuntimesCache } from '../utils/agentPickerCache'
import { useGridDrag } from '../hooks/useGridDrag'
import { sessionIdOf, sessionIdsExcept, withAutoLabel, withProjectLabel, withRename, withSessionId, type AgentTab } from '../utils/agentTabs'
import { agentTabStorageKey } from '../utils/agentTabStorage'
import {
  DEFAULT_AGENT_QUEUE_EDIT_HEIGHT,
  MIN_AGENT_QUEUE_EDIT_HEIGHT,
  agentInputMaxHeight,
  agentQueueEditMaxHeight,
  resizedHeightFromTop,
} from '../utils/agentInputLayout'
import { outsideTerminal } from '../utils/terminalFocus'
import { nextLocalMinuteValue } from '../utils/scheduleTime'
import {
  foldEvents,
  formatDuration,
  isTurnComplete,
  type AgentAuthState,
  type AgentAuthUrl,
  type AgentMessageSettings,
  type AgentEvent,
  type Item,
  type ModelState,
  type ModeState,
  type ThinkingState,
  type SessionInfo,
  type SessionMeta,
} from '../utils/agentFold'

/** ACP가 주는 이름은 영어다 — 아는 모드만 우리 말로 바꾸고 나머지는 그대로 쓴다 */
const MODE_LABEL: Record<string, string> = {
  get default() { return uiText("승인 필요") },
  get acceptEdits() { return uiText("편집 자동 승인") },
  get plan() { return uiText("계획만") },
  get dontAsk() { return uiText("묻지 않음(거절)") },
  get bypassPermissions() { return uiText("권한 무시") },
  // codex
  get 'read-only'() { return uiText("읽기만") },
  get auto() { return uiText("작업 폴더만") },
  get 'full-access'() { return uiText("전체 허용") },
  get agent() { return uiText("작업 폴더만") },
  get 'agent-full-access'() { return uiText("전체 허용") },
  // hermes
  get accept_edits() { return uiText("편집 자동 승인") },
  get dont_ask() { return uiText("묻지 않음(허용)") },
}

const RUNTIME_KEY = 'mew:agent-runtime'
const TABS_KEY = 'mew:agent-tabs'
/** 마지막으로 보던 탭 — 창을 다시 열거나 브라우저를 껐다 켜도 그 대화로 돌아온다 */
const ACTIVE_TAB_KEY = 'mew:agent-active-tab'

/** 0062 시절의 미선택 탭을 복원할 때만 쓰는 이전 이름. 새 UI에서는 만들지 않는다. */
const LEGACY_PENDING_TAB_LABEL = '새 대화'

/** 탭 줄이 그리는 살아 있는 값 — 대화가 아니라 상태라 localStorage에 남기지 않는다 */
type TabInfo = { busy: boolean; sessionId: string }

// 새 탭은 반드시 서버에서 확인한 cwd가 있어야 한다. 복원 데이터 호환 때문에 AgentTab.cwd 자체는
// null을 허용하지만, 새 탭 생성 경로까지 허용하면 렌더 필터에서 빠져 빈 화면만 남는다.
const newTab = (runtime: string, label: string, cwd: string, preset?: AgentTab['preset']): AgentTab => ({
  id: Math.random().toString(36).slice(2, 10),
  label,
  runtime,
  cwd,
  // 선택한 런타임/셋 이름이 탭의 이름이다. 첫 프롬프트가 이를 덮지 않는다.
  renamed: true,
  ...(preset ? { preset } : {}),
})

const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

/** 소프트 키보드를 띄우는 요소 — 여기 포커스가 남아 있으면 엉뚱한 탭에도 키보드가 딸려 온다 */
const KEYBOARD_OWNER = 'textarea, input, [contenteditable="true"]'

/** 최소 높이는 좁은 화면의 하한일 뿐, 평소 작성을 위한 기본 높이는 따로 둔다. */
const DEFAULT_AGENT_INPUT_HEIGHT = 180
const AGENT_INPUT_HEIGHT_KEY = 'mew:agent-input-height'
/** 모바일 visualViewport 경계의 반올림·키보드 액세서리 영역을 피하는 하단 안전 간격. */
const MOBILE_AGENT_INPUT_BOTTOM_GUARD_PX = 8
function initialAgentInputHeight() {
  try {
    const saved = Number(localStorage.getItem(AGENT_INPUT_HEIGHT_KEY))
    if (Number.isFinite(saved) && saved > 0) {
      return Math.min(agentInputMaxHeight(window.innerHeight), saved)
    }
  } catch { /* localStorage를 쓸 수 없어도 기본 높이로 연다 */ }
  return Math.min(agentInputMaxHeight(window.innerHeight), DEFAULT_AGENT_INPUT_HEIGHT)
}

function ResizableQueueTextarea({
  value,
  onChange,
  onKeyDown,
  label,
}: {
  value: string
  onChange: (value: string) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  label: string
}) {
  useUiLocale()
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(DEFAULT_AGENT_QUEUE_EDIT_HEIGHT)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  const maxHeight = () => {
    const sessionHeight = containerRef.current
      ?.closest<HTMLElement>('[data-agent-session]')
      ?.getBoundingClientRect().height
      ?? window.visualViewport?.height
      ?? window.innerHeight
    return agentQueueEditMaxHeight(sessionHeight)
  }

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    resizeCleanupRef.current?.()

    const pointerId = event.pointerId
    const startY = event.clientY
    const startHeight = containerRef.current?.getBoundingClientRect().height ?? height
    const limit = maxHeight()
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      setHeight(resizedHeightFromTop(startHeight, startY, moveEvent.clientY, MIN_AGENT_QUEUE_EDIT_HEIGHT, limit))
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = null
    }
    const onEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId === pointerId) cleanup()
    }
    resizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  const resizeWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const delta = event.key === 'ArrowUp' ? 12 : -12
    setHeight((current) => Math.min(maxHeight(), Math.max(MIN_AGENT_QUEUE_EDIT_HEIGHT, current + delta)))
  }

  useEffect(() => () => resizeCleanupRef.current?.(), [])

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1" style={{ height: `${height}px` }}>
      <div
        role="separator"
        aria-label={uiText("{p0} 높이 조절", { p0: label })}
        aria-orientation="horizontal"
        aria-valuemin={MIN_AGENT_QUEUE_EDIT_HEIGHT}
        aria-valuemax={maxHeight()}
        aria-valuenow={Math.round(height)}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
        className="group absolute inset-x-0 -top-1.5 z-20 h-3 cursor-row-resize touch-none outline-none"
        title={uiText("끌어서 편집칸 높이 조절")}
      >
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent group-hover:bg-accent group-focus-visible:bg-accent" />
      </div>
      <textarea
        autoFocus={canAutoFocusInput()}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="h-full w-full resize-none rounded bg-surface-raised px-2 py-1 text-xs text-ink outline-none"
      />
    </div>
  )
}

/**
 * 이 창에서 모바일 키보드를 띄우는 건 채팅 입력칸 하나뿐이다.
 *
 * 크로미움은 편집 가능한 요소에 포커스가 남아 있으면 버튼 탭까지 "키보드를 다시 띄워 달라"로 받아,
 * 뒤로가기로 내려둔 키보드를 도로 올린다. keepFocusOnPress가 버튼 탭에서 포커스를 지켜 주기 때문에
 * (그래야 click이 안 사라진다 — 그 주석 참고) 창 뒤에 깔린 에디터나 이 창의 입력칸이 포커스를 쥔 채로
 * 남고, 접기·펼치기 같은 버튼만 눌러도 키보드가 올라온다. 그래서 눌린 뒤에 포커스를 떼어 낸다.
 *
 * 떼는 시점이 둘로 갈리는 이유: 입력칸을 mousedown에서 떼면 키보드가 내려가며 레이아웃이 커지고
 * 버튼이 손가락 밑에서 밀려나 click이 통째로 사라진다. 그래서 **창 안 입력칸은 click이 끝난 뒤**,
 * 창 밖(에디터·터미널)은 곧바로 뗀다. 데스크톱은 손대지 않는다 — 키보드도 없고, 옆에서 버튼 하나
 * 눌렀다고 쓰던 문서의 커서가 날아가면 안 된다.
 */
function dropOutsideFocus(e: MouseEvent<HTMLDivElement>) {
  keepFocusOnPress(e)
  if (isDesktop()) return
  const active = document.activeElement
  if (active instanceof HTMLElement && !e.currentTarget.contains(active)) active.blur()
}

/** 창 안 버튼을 누른 뒤 입력칸의 포커스를 뗀다 — data-keep-keyboard(입력줄)는 예외로 그대로 둔다 */
function dropInputFocusAfterPress(e: MouseEvent<HTMLDivElement>) {
  if (isDesktop()) return
  const target = e.target
  if (!(target instanceof Element) || !target.closest('button') || target.closest('[data-keep-keyboard]')) return
  const active = document.activeElement
  // 버튼 자신은 놔둔다 — 키보드로 Tab·Enter 하는 사람의 포커스까지 날려 버리면 안 된다
  if (active instanceof HTMLElement && active.matches(KEYBOARD_OWNER)) active.blur()
}

/**
 * 말풍선 본문은 접기 버튼 안에 있다 — 글자를 끌어 고른 뒤 손을 떼면 그 click이 버블을 접어 버린다.
 * 골라 둔 글자가 있으면 그 클릭은 "고르기의 끝"이지 "접기"가 아니다.
 */
function hasSelection(): boolean {
  return (window.getSelection()?.toString().length ?? 0) > 0
}

type AgentAttachment = {
  project: string
  mimeType: string
  /** 서버가 충돌을 피해 결정한 실제 경로 — 프롬프트에는 이 값만 보낸다. */
  relPath: string
  /** 태그에는 경로·파일명 대신 확장자만 보여 준다. */
  extension: string
  /** 사진 태그는 전송 전에도 원본을 크게 확인할 수 있다. */
  isImage: boolean
  /** Codex가 볼 수 있는 사진은 파일 경로와 함께 바이트도 ACP로 보낸다. */
  image?: { data: string; mimeType: string }
}

type QueuedEdit = { index: number; text: string; original: string; attachments: AgentAttachment[]; settings: AgentMessageSettings }

function queuedAttachmentInput(file: AgentAttachment): AgentAttachmentInput {
  return { project: file.project, path: file.relPath, mimeType: file.mimeType, image: file.image }
}

function AgentAttachmentList({ attachments, attaching, onPreview, onRemove }: {
  attachments: AgentAttachment[]
  attaching: boolean
  onPreview: (file: AgentAttachment) => void
  onRemove: (file: AgentAttachment) => void
}) {
  if (!attachments.length && !attaching) return null
  return (
    <div className="flex h-6 shrink-0 items-center gap-1 overflow-x-auto" aria-label={uiText("첨부 파일 {p0}개", { p0: attachments.length })}>
      {attaching && <span className="flex h-6 shrink-0 items-center gap-1 rounded-md bg-surface-raised pl-2 pr-1.5 text-xs text-ink-muted" role="status">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-muted/30 border-t-accent" aria-hidden="true" />
        {uiText("첨부 중…")}
      </span>}
      {attachments.map(attachment => (
        <span key={`${attachment.project}:${attachment.relPath}`} title={attachment.relPath.split('/').pop()} className="flex h-6 shrink-0 items-center gap-0.5 rounded-md bg-surface-raised p-1 text-xs text-ink-secondary">
          {attachment.isImage ? <button type="button" onClick={() => onPreview(attachment)}
            className="min-w-0 truncate rounded px-0.5 text-left hover:text-ink hover:underline" title={uiText("사진 미리보기")}>
            {attachment.extension}
          </button> : <span className="min-w-0 flex-1 truncate">{attachment.extension}</span>}
          <button type="button" onClick={() => onRemove(attachment)}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
            aria-label={uiText("{p0} 첨부 제거", { p0: attachment.extension })} title={uiText("첨부 제거")}>
            <XGlyph small />
          </button>
        </span>
      ))}
    </div>
  )
}

const AGENT_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_AGENT_IMAGE_BYTES = 10 * 1024 * 1024

function attachmentExtension(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : uiText("파일")
}

/** 캡처 프로그램은 Clipboard File의 이름을 빈 문자열이나 `blob`으로 주기도 한다. */
function namedAttachment(file: File): File {
  if (file.name && /\.[^./]+$/.test(file.name)) return file
  const extension = file.type === 'image/jpeg' ? 'jpg'
    : file.type === 'image/png' ? 'png'
      : file.type === 'image/webp' ? 'webp'
        : file.type === 'image/gif' ? 'gif'
          : 'bin'
  return new File([file], `clipboard-${Date.now()}.${extension}`, { type: file.type, lastModified: file.lastModified })
}

async function imageForAgent(file: File): Promise<AgentAttachment['image']> {
  if (!AGENT_IMAGE_TYPES.has(file.type)) return undefined
  if (file.size > MAX_AGENT_IMAGE_BYTES) throw new Error(uiText("사진은 에이전트에 최대 10MB까지 첨부할 수 있습니다: {p0}", { p0: file.name || uiText("이름 없는 이미지") }))
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(uiText("사진을 읽지 못했습니다: {p0}", { p0: file.name || uiText("이름 없는 이미지") })))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(uiText("사진 데이터를 읽지 못했습니다")))
    reader.readAsDataURL(file)
  })
  return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: file.type }
}

function loadTabs(workspacePath: string | null): AgentTab[] {
  try {
    const key = agentTabStorageKey(TABS_KEY, workspacePath)
    const raw = localStorage.getItem(key)
    // 프로젝트 독립이던 이전 저장값은, 처음 완전히 식별된 루트 프로젝트 하나에만 귀속한다.
    // 그대로 두면 아직 탭이 없는 다음 프로젝트에도 같은 목록이 다시 나타난다.
    const legacy = raw === null && workspacePath ? localStorage.getItem(TABS_KEY) : null
    const saved: unknown = JSON.parse(raw ?? legacy ?? '[]')
    if (Array.isArray(saved)) {
      const tabs = saved.filter((entry): entry is AgentTab => {
        const tab = entry as AgentTab | null
        return typeof tab?.id === 'string' && typeof tab?.label === 'string'
          && (tab.cwd === undefined || tab.cwd === null || typeof tab.cwd === 'string')
      })
      if (tabs.length > 0) {
        // ADR 0062 이전 탭에는 runtime이 없다. 마지막으로 쓴 런타임을 한 번만 승격해
        // 기존 runtime+tab 세션 키와 히스토리를 보전한다. 새 탭은 여전히 미선택으로 만든다.
        const legacyRuntime = localStorage.getItem(RUNTIME_KEY)
        const migratedRuntime = RUNTIMES.some((runtime) => runtime.id === legacyRuntime) ? legacyRuntime! : DEFAULT_RUNTIME_ID
        const normalizedTabs = tabs.flatMap((tab) => {
          // 예전의 미선택 "새 대화" 탭은 이제 선택기 자체로 바뀌었으므로 복원하지 않는다.
          if (tab.runtime === null && tab.label === LEGACY_PENDING_TAB_LABEL) return []
          const sessionIds = tab.sessionIds && typeof tab.sessionIds === 'object'
            ? Object.fromEntries(Object.entries(tab.sessionIds).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
            : undefined
          const normalized = sessionIds && Object.keys(sessionIds).length > 0 ? { ...tab, sessionIds } : { ...tab, sessionIds: undefined }
          const upgraded = normalized.runtime === undefined ? { ...normalized, runtime: migratedRuntime } : normalized
          // Gemini 개인 계정 경로는 종료되어 런타임과 함께 제거됐다. 알 수 없는 옛 런타임도
          // fallback Claude 탭으로 바꾸지 않고 버린다 — 다른 CLI를 뜻없이 실행하면 안 된다.
          if (upgraded.runtime && !RUNTIMES.some((runtime) => runtime.id === upgraded.runtime)) return []
          // 선택만 하고 입력하지 않았던 이전 탭도 새 이름 규칙으로 한 번 승격한다.
          return upgraded.label === LEGACY_PENDING_TAB_LABEL && upgraded.runtime
            ? [{ ...upgraded, label: runtimeOf(upgraded.runtime).label, renamed: true }]
            : [upgraded]
        })
        if (legacy !== null) {
          if (writeBrowserStorage(key, JSON.stringify(normalizedTabs))) localStorage.removeItem(TABS_KEY)
        }
        return normalizedTabs
      }
    }
  } catch {
    /* 깨진 값이면 새 탭으로 시작한다 */
  }
  return []
}

function loadActiveTabId(tabs: AgentTab[], workspacePath: string | null): string | null {
  const key = agentTabStorageKey(ACTIVE_TAB_KEY, workspacePath)
  const stored = localStorage.getItem(key)
  const legacy = stored === null && workspacePath ? localStorage.getItem(ACTIVE_TAB_KEY) : null
  const activeId = stored ?? legacy
  if (legacy !== null) {
    if (activeId && tabs.some((tab) => tab.id === activeId) && writeBrowserStorage(key, activeId)) localStorage.removeItem(ACTIVE_TAB_KEY)
  }
  return activeId && tabs.some((tab) => tab.id === activeId) ? activeId : (tabs[0]?.id ?? null)
}

/** 탭 이름 — 대화에서 첫 질문 한 줄을 뽑는다. 선택 이름을 고정한 새 탭에는 적용되지 않는다. */
function labelOf(items: Item[]): string {
  const first = items.find((item) => item.kind === 'user')
  if (!first || first.kind !== 'user') return ''
  const line = first.text.trim().split('\n')[0]
  if (!line) return ''
  return line.length > 24 ? `${line.slice(0, 24)}…` : line
}

const STATUS_LABEL: Record<string, string> = {
  get pending() { return uiText("대기") },
  get in_progress() { return uiText("실행 중") },
  get completed() { return uiText("완료") },
  get failed() { return uiText("실패") },
}

/** 버블 상태 — 색은 한 곳에서만 정한다(턴 버블·작업 묶음·작업 한 줄이 같은 뜻이면 같은 색이어야 한다) */
type BubbleState = 'running' | 'failed' | 'cancelled' | 'done'
const BUBBLE_DOT: Record<BubbleState, string> = {
  running: 'bg-blue-500',
  failed: 'bg-danger',
  cancelled: 'bg-ink-muted',
  done: 'bg-success',
}
const BUBBLE_LABEL: Record<BubbleState, string> = {
  get running() { return uiText("작업 중") },
  get failed() { return uiText("에러") },
  get cancelled() { return uiText("중단됨") },
  get done() { return uiText("완료") },
}

function turnState(item: Extract<Item, { kind: 'turn' }>, busy: boolean | null): BubbleState {
  if (!isTurnComplete(item, busy)) return 'running'
  if (item.stopReason === 'error' || item.children.some((c) => c.kind === 'error')) return 'failed'
  if (item.stopReason === 'cancelled') return 'cancelled'
  return 'done'
}

function toolState(status: string): BubbleState {
  if (status === 'failed') return 'failed'
  if (status === 'completed') return 'done'
  return 'running'
}

const nf = { format: (value: number) => new Intl.NumberFormat(getUiLocale()).format(value) }
/** 토큰 수는 자릿수가 길어 줄을 밀어낸다 — 1.2K·3.4M으로 줄인다(ko-KR은 '천·만'이 되므로 en-US) */
const tf = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(getUiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 몇 센트짜리 세션도 0으로 보이면 안 된다 — 1달러 밑은 세 자리까지 */
function formatUsd(cost: number): string {
  return cost < 1 ? `$${cost.toFixed(3)}` : `$${cost.toFixed(2)}`
}

function formatElapsed(iso: string | null, now: number): string {
  if (!iso) return ''
  const start = new Date(iso).getTime()
  if (Number.isNaN(start)) return ''
  const minutes = Math.max(0, Math.floor((now - start) / 60_000))
  if (minutes < 60) return uiText("{p0}분째", { p0: minutes })
  const hours = Math.floor(minutes / 60)
  return uiText("{p0}시간 {p1}분째", { p0: hours, p1: minutes % 60 })
}

function InfoRow({ label, value, title }: { label: string; value: string; title?: string }) {
  useUiLocale()
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-ink-muted">{label}</span>
      <span className="truncate text-right text-ink-secondary" title={title ?? value}>{value}</span>
    </div>
  )
}


type OpenWorkspaceFile = (project: string, path: string, line: number | null) => void

function handleMarkdownClick(e: MouseEvent<HTMLElement>, onOpenFile: OpenWorkspaceFile) {
  const text = copyTextFromAgentMarkdownClick(e.target)
  if (text !== null) {
    e.preventDefault()
    e.stopPropagation()
    void copyText(text).then((ok) => {
      if (ok) markAgentMarkdownCopied(e.target)
    })
    return
  }

  const href = agentMarkdownHrefFromClick(e.target)
  if (!href || !isAgentWorkspaceHref(href)) return
  e.preventDefault()
  e.stopPropagation()
  void resolveAgentFileLink(href)
    .then(({ target }) => {
      if (target) onOpenFile(target.project, target.path, target.line)
    })
    .catch(console.error)
}

function selectedSkillNames(text: string, skills: SkillSummary[]): string[] {
  const names = new Set(skills.map((skill) => skill.name))
  const selected = new Set<string>()
  for (const match of text.matchAll(/(^|\s)\/([A-Za-z0-9][A-Za-z0-9._-]*)/g)) {
    const name = match[2]
    if (names.has(name)) selected.add(name)
  }
  return [...selected]
}

type AgentControlCache = { models: ModelState | null; modes: ModeState | null; thinking: ThinkingState | null }
function agentControlCacheKey(runtime: string, tabId: string, cwd: string) {
  return `mew:agent-controls:${runtime}:${tabId}:${cwd}`
}
function readAgentControlCache(runtime: string, tabId: string, cwd: string): AgentControlCache {
  try {
    const saved = JSON.parse(localStorage.getItem(agentControlCacheKey(runtime, tabId, cwd)) ?? '') as Partial<AgentControlCache>
    return {
      models: saved.models && Array.isArray(saved.models.availableModels) && typeof saved.models.currentModelId === 'string' ? saved.models : null,
      modes: saved.modes && Array.isArray(saved.modes.availableModes) && typeof saved.modes.currentModeId === 'string' ? saved.modes : null,
      thinking: saved.thinking && Array.isArray(saved.thinking.options) && typeof saved.thinking.configId === 'string' && typeof saved.thinking.currentValue === 'string' ? saved.thinking : null,
    }
  } catch { return { models: null, modes: null, thinking: null } }
}
function writeAgentControlCache(runtime: string, tabId: string, cwd: string, patch: Partial<AgentControlCache>) {
  const current = readAgentControlCache(runtime, tabId, cwd)
  try { writeBrowserStorage(agentControlCacheKey(runtime, tabId, cwd), JSON.stringify({ ...current, ...patch })) } catch { /* 저장 공간이 없어도 선택기는 정상 동작한다 */ }
}

/**
 * 헤더의 모델·권한 모드 선택 — OS 기본 <select> 대신 쓰는 자체 드롭다운.
 * 입력 바로 위 설정 줄에서 위로 펼친다. 본문 컨테이너의 overflow와 프로젝트 탭바보다 위에
 * 보여야 하므로 목록만 document.body 포털로 낸다.
 */
function HeaderSelect({
  value,
  options,
  onPick,
  title,
  trigger,
  searchable,
  disabled,
  className,
  caretEnd = false,
}: {
  value: string
  options: { id: string; label: string }[]
  onPick: (id: string) => void
  title: string
  /** 버튼에 이름 대신 그릴 것(런타임 아이콘) */
  trigger?: ReactNode
  /** 목록이 길 때(모델) — 열리면 검색 입력이 먼저 뜬다 */
  searchable?: boolean
  disabled?: boolean
  className?: string
  /** 넓게 채우는 선택기(모델)는 화살표를 버튼 끝에 붙인다. */
  caretEnd?: boolean
}) {
  useUiLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState<{ left: number; bottom: number; width: number; maxHeight: number } | null>(null)
  const close = useCallback(() => setOpen(false), [])
  // Esc·모바일 뒤로가기가 패널 대신 이 드롭다운을 닫게 한다
  useOverlayDismiss(open && close)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  useEffect(() => {
    if (!open) return
    const placeMenu = () => {
      const bounds = buttonRef.current?.getBoundingClientRect()
      if (!bounds) return
      // 위쪽에 남은 공간만 목록의 최대 높이로 쓴다. 따라서 화면 밖으로 넘어가지 않고 목록만 스크롤된다.
      const gap = 8
      setMenuPosition({
        left: Math.max(gap, bounds.left),
        bottom: Math.max(gap, window.innerHeight - bounds.top + gap),
        width: bounds.width,
        maxHeight: Math.max(48, bounds.top - gap * 2),
      })
    }
    placeMenu()
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    window.visualViewport?.addEventListener('resize', placeMenu)
    window.visualViewport?.addEventListener('scroll', placeMenu)
    return () => {
      window.removeEventListener('resize', placeMenu)
      window.removeEventListener('scroll', placeMenu, true)
      window.visualViewport?.removeEventListener('resize', placeMenu)
      window.visualViewport?.removeEventListener('scroll', placeMenu)
    }
  }, [open])

  const current = options.find((o) => o.id === value)
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)) : options
  return (
    <div ref={ref} className={`relative min-w-0 ${className ?? ''} ${open ? 'z-50' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setQuery('')
          setOpen((v) => !v)
        }}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs hover:bg-surface-raised hover:text-ink ${
          open ? 'bg-surface-raised text-ink' : 'bg-surface text-ink-secondary disabled:cursor-default disabled:opacity-70'
        }`}
      >
        {trigger ?? <span className={caretEnd ? 'min-w-0 flex-1 truncate' : 'truncate'}>{current?.label ?? value}</span>}
        <span className={caretEnd ? 'ml-auto shrink-0' : 'shrink-0'}><CaretGlyph dir={open ? 'down' : 'up'} /></span>
      </button>
      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={title}
          className="fixed z-[1201] flex flex-col overflow-hidden whitespace-nowrap rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl"
          style={{ left: `${menuPosition.left}px`, bottom: `${menuPosition.bottom}px`, minWidth: `${menuPosition.width}px`, maxHeight: `${menuPosition.maxHeight}px` }}
        >
          {/* 모델 수가 많아도 화면에 맞춰 목록 자체만 스크롤한다. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {shown.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                onClick={() => {
                  onPick(option.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-hover ${
                  option.id === value ? 'text-ink' : 'text-ink-secondary'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span className="flex w-3.5 shrink-0 items-center justify-center">{option.id === value && <CheckGlyph />}</span>
              </button>
            ))}
            {shown.length === 0 && <div className="px-2.5 py-1.5 text-xs text-ink-muted">{uiText("결과 없음")}</div>}
          </div>
          {searchable && (
            <input
              autoFocus={canAutoFocusInput()}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Enter는 첫 번째 결과 선택 — 몇 글자 치고 바로 고르는 흐름
                if (e.key === 'Enter' && shown.length > 0) {
                  onPick(shown[0].id)
                  setOpen(false)
                }
              }}
              placeholder={uiText("검색")}
              className="mx-1 mt-1 w-[calc(100%-0.5rem)] rounded bg-surface px-2 py-1 text-xs text-ink outline-none placeholder:text-ink-muted"
            />
          )}
        </div>
      , document.body)}
    </div>
  )
}

/**
 * 히스토리 버튼 — **누를 때 비로소** 목록을 물어본다(onOpen): 붙을 때마다 미리 훑으면 세션 파일 훑기가
 * 탭 수만큼 곱해져 창이 굳는다. 현재 대화에 기록이 있으면 목록 맨 위에서 즉시 새 대화로 바꿀 수도 있다.
 */
function SessionPicker({
  sessions,
  takenIds,
  currentSessionId,
  loadingSession,
  hasConversation,
  disabled = false,
  onOpen,
  onPick,
  onNewConversation,
  onRefresh,
  refreshDisabled = false,
  loadDisabledReason,
}: {
  sessions: SessionInfo[] | null
  /** 다른 탭이 이미 열어 둔 세션 — 같은 세션을 두 프로세스가 붙들면 전사가 엉킨다 */
  takenIds: string[]
  currentSessionId: string | null
  loadingSession: string | null
  hasConversation: boolean
  disabled?: boolean
  /** 드롭다운을 열었다 — 여기서 목록을 받아 온다 */
  onOpen: () => void | Promise<void>
  onPick: (session: SessionInfo) => void
  onNewConversation: () => void
  onRefresh?: () => void
  refreshDisabled?: boolean
  loadDisabledReason?: string
}) {
  useUiLocale()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [sessionIdInput, setSessionIdInput] = useState('')
  const pickerId = useId()
  const sessionId = sessionIdInput.trim()
  const inputHint = loadDisabledReason
    || (sessionId && sessionId === currentSessionId ? t('agent.history.current') : '')
    || (takenIds.includes(sessionId) ? t('agent.history.taken') : '')
  const loadDisabled = disabled || loadingSession !== null || !!loadDisabledReason
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // Esc·모바일 뒤로가기가 패널 대신 이 드롭다운을 닫게 한다
  useOverlayDismiss(open && close)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      // Portal dialogs belong to the dropdown; interacting with them must not unmount it.
      if (e.target instanceof Element && e.target.closest('[role="dialog"]')) return
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  return (
    <div ref={ref} className="relative text-xs">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!open) void onOpen()
          setOpen((v) => !v)
        }}
        aria-controls={open ? pickerId : undefined}
        aria-expanded={open}
        aria-label={uiText("히스토리")}
        title={uiText("히스토리")}
        className={`flex h-6 items-center gap-1 rounded px-1.5 hover:bg-surface-hover disabled:opacity-40 ${
          open ? 'bg-surface-hover text-ink' : 'text-ink-secondary hover:text-ink'
        }`}
      >
        <HistoryGlyph />
        <span>{uiText("히스토리")}</span>
      </button>
      {open && (
        <div
          id={pickerId}
          role="region"
          aria-label={uiText("지난 세션")}
          className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl"
        >
          <form
            className="border-b border-edge px-2.5 pb-2 pt-1"
            onSubmit={(event) => {
              event.preventDefault()
              if (!sessionId || loadDisabled || inputHint) return
              onPick(sessions?.find((session) => session.sessionId === sessionId) ?? { sessionId })
              setOpen(false)
            }}
          >
            <label htmlFor={`${pickerId}-input`} className="mb-1 block text-ink-secondary">{t('agent.history.sessionId')}</label>
            <div className="flex gap-1.5">
              <input
                id={`${pickerId}-input`}
                value={sessionIdInput}
                onChange={(event) => setSessionIdInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault()
                }}
                placeholder={t('agent.history.enterId')}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="go"
                disabled={loadDisabled}
                aria-describedby={inputHint ? `${pickerId}-hint` : undefined}
                className="h-9 min-w-0 flex-1 rounded border border-edge-bright bg-surface px-2 text-ink placeholder:text-ink-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
              />
              <button
                type="submit"
                disabled={!sessionId || loadDisabled || !!inputHint}
                className="h-9 shrink-0 rounded bg-surface-hover px-2.5 text-ink hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
              >
                {t('agent.history.open')}
              </button>
            </div>
            {inputHint && <p id={`${pickerId}-hint`} role="status" className="mt-1 text-ink-secondary">{inputHint}</p>}
          </form>
          {/* 한 번에 다섯 줄쯤만 보이고 나머지는 여기서만 스크롤된다 */}
          <div className="max-h-56 overflow-y-auto">
            {onRefresh && currentSessionId && (
              <button
                type="button"
                disabled={refreshDisabled || loadingSession !== null}
                onClick={() => { onRefresh(); setOpen(false) }}
                title={uiText("외부에서 이어 쓴 대화를 다시 불러옵니다. 진행 중인 작업이 없어야 합니다.")}
                className="flex w-full items-center gap-2 border-b border-edge px-2.5 py-2 text-left text-ink hover:bg-surface-hover disabled:opacity-40"
              >
                <HistoryGlyph />
                <span>{uiText("현재 대화 새로고침")}</span>
              </button>
            )}
            {hasConversation && (
              <button
                type="button"
                onClick={() => {
                  onNewConversation()
                  setOpen(false)
                }}
                disabled={loadingSession !== null}
                className="flex w-full items-center gap-2 border-b border-edge px-2.5 py-2 text-left text-ink hover:bg-surface-hover disabled:opacity-40"
              >
                <PlusGlyph />
                <span>{uiText("새 대화")}</span>
              </button>
            )}
            {sessions === null && <AgentLoadingBubbles label={t('common.loading')} compact />}
            {sessions?.length === 0 && (
              <div className="px-2.5 py-1.5 text-ink-muted">{uiText("이 워크스페이스에 지난 세션이 없습니다.")}</div>
            )}
            {sessions?.map((session) => {
              const taken = takenIds.includes(session.sessionId)
              const current = session.sessionId === currentSessionId
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  onClick={() => {
                    onPick(session)
                    setOpen(false)
                  }}
                  disabled={current || taken || loadDisabled}
                  className="flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left hover:bg-surface-hover disabled:opacity-40"
                >
                  <span className="w-full truncate text-ink">{session.title || session.sessionId.slice(0, 8)}</span>
                  <span className="text-ink-muted">
                    {session.sessionId === loadingSession
                      ? uiText("불러오는 중…")
                      : current
                        ? uiText("현재 탭에서 열림")
                        : taken
                          ? uiText("다른 탭에서 열림")
                        : formatTime(session.updatedAt ?? null)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/** 탭 줄 — `+`는 탭을 만들기 전에 런타임 또는 에이전트셋 선택기를 연다. */
function AgentTabBar({
  tabs,
  activeId,
  pickerOpen,
  infos,
  onActivate,
  onAdd,
  onRename,
  onReorder,
  onCloseTab,
  onClosePanel,
  group,
}: {
  group?: string
  tabs: AgentTab[]
  activeId: string | null
  /** 선택기는 아직 저장되는 탭이 아니지만, 탭 줄에서는 `+`가 현재 탭처럼 선다. */
  pickerOpen: boolean
  infos: Record<string, TabInfo>
  onActivate: (id: string) => void
  onAdd: () => void
  onRename: (id: string, label: string) => void
  onReorder: (from: number, to: number) => void
  onCloseTab: (id: string) => void
  onClosePanel: () => void
}) {
  useUiLocale()
  // Desktop double-click expands the panel; F2 edits its tab name. Mobile keeps double-tap rename.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  // 문서 탭·터미널 탭과 같은 훅 — 꾹 눌러 끌면 순서 바꾸기, 그냥 끌면 탭 줄 굴리기
  const scopeRef = useRef<HTMLDivElement>(null)
  useFocusedShortcutScope(scopeRef, { closeTab: () => { if (!activeId || pickerOpen) return false; onCloseTab(activeId); return true } })
  const dock = useDock()
  const drag = useDragReorder({ onReorder, immediateMouseDrag: true, onDragMove: (index, x, y) => { if (group && tabs[index]) dock?.preview(group, tabs[index].id, x, y) }, onDrop: (index, x, y) => { if (group && tabs[index]) dock?.drop(group, tabs[index].id, x, y) } })
  return (
    <div data-dock-tab-bar ref={scopeRef} className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
      {group && <DockGrip group={group} />}
      <div className="no-scrollbar flex h-full min-w-0 flex-1 items-center overflow-x-auto">
        {tabs.length === 0 && <PanelTitle kind={group?.startsWith('terminal') ? 'terminal' : 'agent'} />}
        {tabs.map((tab, i) => {
          // 새 탭 선택기가 열려 있으면 `+`가 가상 활성 탭이다. 직전 대화 탭을 함께 활성으로 보이지 않는다.
          const isActive = !pickerOpen && tab.id === activeId
          const runtime = runtimeOf(tab.runtime ?? DEFAULT_RUNTIME_ID)
          return (
            <div
              key={tab.id}
              {...drag.getItemProps(i)}
              role="tab" tabIndex={0} aria-selected={isActive} aria-keyshortcuts="Shift+Enter F2"
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'F2') { event.preventDefault(); setEditing({ id: tab.id, text: tab.label }) }
                else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate(tab.id) }
              }}
              draggable={false}
              onDragStart={(event) => { event.preventDefault(); event.stopPropagation() }}
              onClick={() => {
                if (drag.consumeClick()) return
                onActivate(tab.id)
              }}
              onContextMenu={(e) => {
                // 터치 길게누르기가 드래그로 예약된 동안 Android 네이티브 메뉴가 끼어들지 않게
                if (drag.dragIndex !== null) e.preventDefault()
              }}
              className={`group flex h-full shrink-0 cursor-pointer items-center gap-1.5 border-r border-edge px-2.5 text-xs select-none [-webkit-touch-callout:none] ${
                isActive ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-raised'
              } ${drag.dragIndex === i ? 'opacity-70 ring-1 ring-inset ring-accent' : ''}`}
            >
              {/* 안 보고 있는 탭이 돌고 있는지 — 탭 줄에서 바로 보이는 유일한 신호다 */}
              {infos[tab.id]?.busy && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />}
              <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-muted" title={runtime.label} aria-label={runtime.label}>
                <runtime.Glyph />
              </span>
              {editing?.id === tab.id ? (
                <input
                  autoFocus={canAutoFocusInput()}
                  value={editing.text}
                  onChange={(e) => setEditing({ id: tab.id, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') return setEditing(null)
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      onRename(tab.id, editing.text)
                      setEditing(null)
                    }
                  }}
                  onBlur={() => {
                    onRename(tab.id, editing.text)
                    setEditing(null)
                  }}
                  className="w-[9rem] rounded bg-surface px-1 text-xs text-ink outline-none select-text"
                  aria-label={uiText("탭 이름")}
                />
              ) : (
                <span
                  onDoubleClick={() => { if (!dock?.desktop) setEditing({ id: tab.id, text: tab.label }) }}
                  title={dock?.desktop ? uiText("F2로 이름 고치기 · 두 번 눌러 패널 확대/복귀") : uiText("두 번 눌러 이름 고치기")}
                  className="max-w-[9rem] truncate"
                >
                  {tab.label}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
                aria-label={uiText("탭 닫기")}
              >
                ×
              </button>
            </div>
          )
        })}
        {tabs.length > 0 && <button
          type="button"
          onClick={onAdd}
          aria-pressed={pickerOpen}
          aria-current={pickerOpen ? 'page' : undefined}
          className={`flex h-full w-9 shrink-0 items-center justify-center border-r border-edge ${
            pickerOpen ? 'bg-surface-raised text-ink' : 'text-ink-secondary hover:bg-surface-raised hover:text-ink'
          }`}
          aria-label={uiText("새 탭")}
          title={uiText("새 탭")}
        >
          <PlusGlyph />
        </button>}
      </div>
      <PanelCloseButton onClick={onClosePanel} aria-label={group?.startsWith('terminal') ? uiText("터미널 닫기") : uiText("에이전트 닫기")} />
    </div>
  )
}

/** 탭의 ACP cwd. 주소창처럼 Enter로 이동하며 실행 중인 작업은 끊지 못하게 잠근다. */
function AgentPathBar({
  cwd,
  workspaceCwd,
  busy,
  saving,
  error,
  sessionReady,
  showInfo,
  onClearSession,
  onToggleInfo,
  onCommit,
}: {
  cwd: string | null
  workspaceCwd: string | null
  busy: boolean
  saving: boolean
  error: string | null
  sessionReady: boolean
  showInfo: boolean
  onClearSession: () => void
  onToggleInfo: () => void
  onCommit: (path: string) => void
}) {
  useUiLocale()
  const [draft, setDraft] = useState(cwd ?? '')
  const [focused, setFocused] = useState(false)
  const [browsedPath, setBrowsedPath] = useState<string | null>(cwd)
  const [suggestions, setSuggestions] = useState<AgentCwdSuggestions | null>(null)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionSeqRef = useRef(0)

  useEffect(() => {
    setDraft(cwd ?? '')
    setBrowsedPath(cwd)
  }, [cwd])
  const disabled = cwd === null || busy || saving

  const loadSuggestions = useCallback((input: string, entered: boolean) => {
    if (!cwd) return
    const seq = ++suggestionSeqRef.current
    setLoadingSuggestions(true)
    setSuggestError(null)
    void fetchAgentCwdSuggestions(input, cwd, entered)
      .then((result) => {
        if (suggestionSeqRef.current === seq) setSuggestions(result)
      })
      .catch((err: unknown) => {
        if (suggestionSeqRef.current !== seq) return
        setSuggestions(null)
        setSuggestError(err instanceof Error ? err.message : String(err))
        if (entered) setBrowsedPath(null)
      })
      .finally(() => {
        if (suggestionSeqRef.current === seq) setLoadingSuggestions(false)
      })
  }, [cwd])

  useEffect(() => {
    if (!focused || disabled || !cwd) return
    const timer = window.setTimeout(() => loadSuggestions(draft, browsedPath === draft), 100)
    return () => clearTimeout(timer)
  }, [browsedPath, cwd, disabled, draft, focused, loadSuggestions])

  const enterDir = (path: string) => {
    setDraft(path)
    setBrowsedPath(path)
    if (canAutoFocusInput()) inputRef.current?.focus()
  }

  const openHere = () => {
    if (!disabled && draft.trim()) onCommit(draft)
  }

  const advanceWithKeyboard = () => {
    if (!cwd) return
    const input = draft
    const seq = ++suggestionSeqRef.current
    setLoadingSuggestions(true)
    setSuggestError(null)
    const explicitlyEntered = input.trim().endsWith('/')
    void fetchAgentCwdSuggestions(input, cwd, explicitlyEntered)
      .then((result) => {
        if (suggestionSeqRef.current !== seq) return
        setSuggestions(result)
        if (explicitlyEntered) {
          setDraft(result.directory)
          setBrowsedPath(result.directory)
          return
        }
        const first = result.dirs[0]
        if (first) enterDir(first.path)
        else setBrowsedPath(input)
      })
      .catch((err: unknown) => {
        if (suggestionSeqRef.current !== seq) return
        setSuggestError(err instanceof Error ? err.message : String(err))
        setSuggestions(null)
        setBrowsedPath(null)
      })
      .finally(() => {
        if (suggestionSeqRef.current === seq) setLoadingSuggestions(false)
      })
  }

  return (
    <div className="relative z-30 shrink-0">
      <div className="flex h-9 items-center gap-2 border-b border-edge bg-surface px-2">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (workspaceCwd) onCommit(workspaceCwd)
          }}
          disabled={disabled || workspaceCwd === null || cwd === workspaceCwd}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink disabled:opacity-40"
          aria-label={uiText("워크스페이스 기본 경로에서 에이전트 열기")}
          title={uiText("워크스페이스 기본 경로로 돌아가기")}
        >
          <HomeGlyph />
        </button>
        <FolderGlyph />
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setBrowsedPath(null)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 0)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setFocused(false)
              event.currentTarget.blur()
              return
            }
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            // 자동완성으로 한 번 들어간 완성 경로에서 Enter를 다시 누르면 그 cwd로 세션을 연다.
            if (browsedPath === draft) return openHere()
            advanceWithKeyboard()
          }}
          disabled={disabled}
          aria-label={uiText("에이전트 작업 경로")}
          aria-expanded={focused}
          aria-controls="agent-cwd-suggestions"
          title={busy ? uiText("작업 중에는 경로를 바꿀 수 없습니다") : uiText("Enter: 폴더 안으로 · 다시 Enter 또는 →: 여기서 에이전트 열기")}
          placeholder={uiText("현재 워크스페이스 불러오는 중…")}
          className={`min-w-0 flex-1 bg-transparent font-mono text-xs outline-none disabled:cursor-not-allowed ${error ? 'text-danger' : 'text-ink-secondary focus:text-ink'}`}
        />
        {saving && <span className="shrink-0 text-[10px] text-ink-muted">{uiText("이동 중…")}</span>}
        {error && <span className="select-text max-w-[35%] shrink-0 truncate text-[10px] text-danger" title={error}>{error}</span>}
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClearSession}
          disabled={!sessionReady}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink disabled:opacity-40"
          aria-label={uiText("새 세션")}
          title={uiText("새 세션 시작 · 이전 대화는 히스토리에 보관")}
        >
          <HistoryGlyph />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onToggleInfo}
          disabled={!sessionReady}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-surface-raised hover:text-ink disabled:opacity-40 ${showInfo ? 'bg-surface-raised text-ink' : 'text-ink-secondary'}`}
          aria-label={uiText("세션 정보")}
          title={uiText("세션 정보")}
        >
          <InfoGlyph />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={openHere}
          disabled={disabled || !draft.trim()}
          className="flex h-6 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink disabled:opacity-40"
          aria-label={uiText("이 경로에서 에이전트 열기")}
          title={uiText("이 경로에서 에이전트 열기")}
        >
          <ArrowGlyph />
        </button>
      </div>
      {focused && !disabled && (
        <div
          id="agent-cwd-suggestions"
          role="listbox"
          className="absolute inset-x-0 top-full max-h-64 overflow-y-auto border-b border-edge-bright bg-surface-raised py-1 shadow-xl"
          onMouseDown={(event) => event.preventDefault()}
        >
          {loadingSuggestions && !suggestions && <div className="px-3 py-2 text-xs text-ink-muted">{uiText("폴더 불러오는 중…")}</div>}
          {suggestError && <div className="select-text px-3 py-2 text-xs text-danger">{suggestError}</div>}
          {!loadingSuggestions && !suggestError && suggestions?.dirs.length === 0 && (
            <div className="px-3 py-2 text-xs text-ink-muted">{uiText("하위 폴더가 없습니다. Enter를 다시 누르거나 →로 이 경로를 여세요.")}</div>
          )}
          {suggestions?.dirs.map((dir, index) => (
            <button
              key={dir.path}
              type="button"
              role="option"
              aria-selected={index === 0}
              onClick={() => enterDir(dir.path)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-surface-hover hover:text-ink ${index === 0 ? 'text-ink' : 'text-ink-secondary'}`}
            >
              <FolderGlyph />
              <span className="min-w-0 flex-1 truncate">{dir.name}</span>
              <span className="min-w-0 max-w-[65%] truncate text-[10px] text-ink-muted">{dir.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// 경로 변경 UI는 제거했지만, 탭 cwd 계약을 되살릴 때 쓸 입력·검증 경로는 이 컴포넌트에 남긴다.
// 현재는 렌더하지 않으므로 빌드가 이를 미사용 심볼로 판단하지 않게 명시한다.
void AgentPathBar

/**
 * 헤더 런타임 아이콘의 드롭다운 — 새 탭의 런타임 목록(RuntimePicker)과 같은 등록표·같은 설치 흐름을
 * 좁은 패널로 그린 것. 고르면 이 탭의 세션이 그 런타임으로 갈아탄다(ADR 0074 — 0062의
 * "탭 안에서 런타임 갈아타기 금지"를 다시 연다). 목록은 열 때 서버에서 한 번 읽는다.
 */
function RuntimeDropdown({ current, onSelect }: { current: string; onSelect: (runtime: string) => void }) {
  useUiLocale()
  const [open, setOpen] = useState(false)
  const [statuses, setStatuses] = useState<AgentRuntimeStatus[] | null>(cachedAgentRuntimes)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  // Esc·모바일 뒤로가기가 패널 대신 이 드롭다운을 닫게 한다
  useOverlayDismiss(open && close)

  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  // 열릴 때마다 최신 설치 상태를 물어본다 — 밖에서 CLI로 설치했을 수도 있다
  useEffect(() => {
    if (!open) return
    let alive = true
    refreshAgentRuntimes()
      .then((runtimes) => {
        if (alive) setStatuses(runtimes)
      })
      .catch((err: unknown) => {
        if (alive) setError({ id: '', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      alive = false
    }
  }, [open])
  useEffect(() => subscribeAgentRuntimes(setStatuses), [])

  const install = (id: string) => {
    setInstalling(id)
    setError(null)
    void installAgentRuntime(id)
      .then(({ status }) => {
        if (!status.installed) throw new Error(uiText("설치 후에도 실행 파일을 찾지 못했습니다"))
        const next = statuses?.map((item) => (item.id === id ? status : item)) ?? [status]
        updateAgentRuntimesCache(next)
        onSelect(id)
        setOpen(false)
      })
      .catch((err: unknown) => {
        setError({ id, message: err instanceof Error ? err.message : String(err) })
        return refreshAgentRuntimes().then(setStatuses)
      })
      .finally(() => setInstalling(null))
  }

  const currentRuntime = runtimeOf(current)
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex h-6 w-6 items-center justify-center rounded ${open ? 'bg-surface-raised text-ink' : 'hover:bg-surface-raised hover:text-ink'}`}
        title={uiText("에이전트: {p0} — 눌러서 바꾸기", { p0: currentRuntime.label })}
      >
        <currentRuntime.Glyph />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={uiText("에이전트 선택")}
          className="absolute left-0 top-full z-40 mt-1 w-72 whitespace-nowrap rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl"
        >
          {statuses === null && !error ? (
            <div className="px-3 py-2 text-xs text-ink-muted">{uiText("런타임 확인 중…")}</div>
          ) : (
            RUNTIMES.filter((runtime) => runtime.id !== 'tmux').map((rt) => {
              const status = statuses?.find((item) => item.id === rt.id)
              const busy = installing === rt.id || status?.installing === true
              return (
                <div key={rt.id} className={`flex items-center gap-2 px-2.5 py-1 ${rt.id === 'tmux' ? 'mb-1' : ''}`}>
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-secondary"><rt.Glyph /></span>
                  <div className={`min-w-0 flex-1 truncate text-xs ${rt.id === current ? 'text-ink' : 'text-ink-secondary'}`}>{rt.label}</div>
                  {rt.id !== 'tmux' && <RuntimeSettingsButton runtimeId={rt.id} label={rt.label} />}
                  {rt.id !== current &&
                    (status?.installed ? (
                      <button
                        type="button"
                        role="option"
                        onClick={() => {
                          onSelect(rt.id)
                          setOpen(false)
                        }}
                        className="shrink-0 rounded px-2 py-0.5 text-xs text-accent hover:bg-surface-hover"
                      >
                        {uiText("사용")}</button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => install(rt.id)}
                        disabled={!status?.installable || busy}
                        className="shrink-0 rounded px-2 py-0.5 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink disabled:opacity-40"
                      >
                        {busy ? uiText("설치 중…") : uiText("설치")}
                      </button>
                    ))}
                </div>
              )
            })
          )}
          {error && <div className="select-text max-h-24 overflow-auto whitespace-pre-wrap px-2.5 py-1.5 text-xs text-danger">{error.message}</div>}
        </div>
      )}
    </div>
  )
}

// 런타임 전환은 탭을 새로 만드는 흐름으로 통일했다. 구현은 기존 탭 데이터 호환을 위해 남겨 둔다.
void RuntimeDropdown

function RuntimePicker({ onSelect, onSelectSet }: { onSelect: (runtime: string) => void; onSelectSet: (set: AgentSet) => void }) {
  useUiLocale()
  const [statuses, setStatuses] = useState<AgentRuntimeStatus[] | null>(cachedAgentRuntimes)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; message: string } | null>(null)
  const [view, setView] = useState<'runtime' | 'set'>(() => localStorage.getItem('mew:agent-picker-view') === 'set' ? 'set' : 'runtime')

  const refresh = useCallback(() => {
    void refreshAgentRuntimes()
      .then(setStatuses)
      .catch((err: unknown) => setError({ id: '', message: err instanceof Error ? err.message : String(err) }))
  }, [])

  useEffect(refresh, [refresh])
  useEffect(() => subscribeAgentRuntimes(setStatuses), [])

  const chooseView = (next: 'runtime' | 'set') => {
    setView(next)
    try { writeBrowserStorage('mew:agent-picker-view', next) } catch { /* 보기 기억 실패는 선택기를 막지 않는다 */ }
  }

  const install = (id: string) => {
    setInstalling(id)
    setError(null)
    void installAgentRuntime(id)
      .then(({ status }) => {
        if (!status.installed) throw new Error(uiText("설치 후에도 실행 파일을 찾지 못했습니다"))
        const next = statuses?.map((item) => (item.id === id ? status : item)) ?? [status]
        updateAgentRuntimesCache(next)
        onSelect(id)
      })
      .catch((err: unknown) => {
        setError({ id, message: err instanceof Error ? err.message : String(err) })
        refresh()
      })
      .finally(() => setInstalling(null))
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
        <div className="w-full max-w-xl">
        <div className="mb-4 mt-4 flex rounded-md bg-surface p-0.5 text-xs">
          <button type="button" onClick={() => chooseView('runtime')} className={`flex-1 rounded px-3 py-1.5 ${view === 'runtime' ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink-secondary'}`}>{uiText("런타임")}</button>
          <button type="button" onClick={() => chooseView('set')} className={`flex-1 rounded px-3 py-1.5 ${view === 'set' ? 'bg-surface-raised text-ink' : 'text-ink-muted hover:text-ink-secondary'}`}>{uiText("에이전트셋")}</button>
        </div>
        {view === 'set' ? <AgentSetPicker onSelect={onSelectSet} /> : statuses === null ? (
          <div className="py-8 text-center text-xs text-ink-muted">{uiText("런타임 확인 중…")}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {RUNTIMES.filter((runtime) => runtime.id !== 'tmux').map((runtime) => {
              const status = statuses.find((item) => item.id === runtime.id)
              const busy = installing === runtime.id || status?.installing === true
              return (
                <div key={runtime.id} className="relative isolate flex min-h-8 flex-wrap items-center gap-2 rounded-md border border-edge bg-surface px-2 py-0.5 sm:min-h-10 sm:px-2.5 sm:py-1.5">
                  <button
                    type="button"
                    aria-label={runtime.label}
                    disabled={!status?.installed || busy}
                    onClick={() => onSelect(runtime.id)}
                    className="absolute inset-0 rounded-md enabled:hover:bg-surface-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  />
                  <span className="pointer-events-none relative flex h-6 w-6 shrink-0 items-center justify-center text-ink-secondary"><runtime.Glyph /></span>
                  <div className="pointer-events-none relative min-w-0 flex-1 truncate text-sm text-ink">{runtime.label}</div>
                  {!status?.installed && (
                    <button
                      type="button"
                      onClick={() => install(runtime.id)}
                      disabled={!status?.installable || busy}
                      className="relative rounded px-2.5 py-1 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink disabled:opacity-40"
                    >
                      {busy ? uiText("설치 중…") : uiText("설치")}
                    </button>
                  )}
                  <div className="relative shrink-0"><RuntimeSettingsButton runtimeId={runtime.id} label={runtime.label} /></div>
                  {error?.id === runtime.id && (
                    <div className="relative select-text max-h-24 w-full basis-full overflow-auto whitespace-pre-wrap text-xs text-danger">{error.message}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {error?.id === '' && <div className="select-text mt-3 whitespace-pre-wrap text-xs text-danger">{error.message}</div>}
      </div>
    </div>
  )
}

export function AgentPanel({ requestedPicker = false, onPickerRuntimeChosen, onRuntimeReady, cacheAccount = 'local', notificationFocused = false, trackRestore, onRunningAgentsChange, requestedNoticeTab, onNoticeHandled, preparedTabs, requestedTab, onRequestedTabHandled, allowAgent = true, allowTerminal = true, project, workspacePath, tree, focusedFilePath, getSelectedText, renderCommandButtons, onOpenFile, onOpenGuidanceFile, onClose, nextTabSignal = 0, previousTabSignal = 0, closeTabSignal = 0, agentOpen = true, terminalOpen = false, onCloseTerminal, onPanelFocus, foregroundKind }: { requestedPicker?: boolean; onPickerRuntimeChosen?: (runtime: string) => void; onRuntimeReady?: (runtime: string) => void; cacheAccount?: string; notificationFocused?: boolean; trackRestore?: <T>(request: Promise<T>) => Promise<T>; onRunningAgentsChange?: (count: number) => void; requestedNoticeTab?: string; onNoticeHandled?: () => void; preparedTabs?: ReturnType<typeof fetchAgentTabs>; requestedTab?: AgentTab | null; onRequestedTabHandled?: () => void; allowAgent?: boolean; allowTerminal?: boolean; foregroundKind?: string | null; agentOpen?: boolean; terminalOpen?: boolean; onCloseTerminal?: () => void; onPanelFocus?: (kind: 'agent' | 'terminal') => void; project: string; workspacePath: string | null; tree: TreeNode[]; focusedFilePath: string | null; getSelectedText?: () => string | null; renderCommandButtons?: (run: (command: string) => void) => ReactNode; onOpenFile: OpenWorkspaceFile; onOpenGuidanceFile?: (path: string) => void; onClose: () => void; nextTabSignal?: number; previousTabSignal?: number; closeTabSignal?: number }) {
  useUiLocale()
  const { t } = useI18n()
  const dock = useDock()
  const latestDock = useRef(dock)
  latestDock.current = dock
  const docked = !!dock
  const [focusedGroup, setFocusedGroup] = useState('agent')
  const [pickerGroup, setPickerGroup] = useState('agent')
  useEffect(() => {
    if (foregroundKind === 'agent' || foregroundKind === 'terminal') setFocusedGroup((group) => dock?.desktop !== false && group.startsWith(foregroundKind) ? group : foregroundKind)
  }, [foregroundKind, dock?.desktop])
  const shortcutScopeRef = useRef<HTMLDivElement>(null)
  const tabsKey = agentTabStorageKey(TABS_KEY, workspacePath)
  const activeTabKey = agentTabStorageKey(ACTIVE_TAB_KEY, workspacePath)
  const [tabs, setTabs] = useState<AgentTab[]>(() => loadTabs(workspacePath))
  const [pickerRequested, setPickerOpen] = useState(false)
  const [tabsSynced, setTabsSynced] = useState(false)
  const pickerOpen = pickerRequested || (!docked && tabsSynced && tabs.length === 0)
  // 다른 기기·다른 루트 화면의 탭도 같은 ACP thread를 잡을 수 있다. 히스토리를 열 때 다시 읽어
  // 마지막 저장 이후 생긴 점유까지 반영한다. 정적 첫 조회만 믿으면 이미 열린 thread를 또 load해
  // Codex가 "active writer" internal error로 거절한다.
  const [sessionClaims, setSessionClaims] = useState<AgentSessionClaim[]>([])
  // 새 탭 cwd는 이미 App이 정한 현재 루트 워크스페이스다. 별도 API 확인이 끝날 때까지 null로
  // 두면 사용자가 먼저 런타임을 고른 순간 렌더 대상에서 빠진 빈 탭이 생긴다.
  const [defaultCwd, setDefaultCwd] = useState<string | null>(workspacePath)
  const [openingRuntime, setOpeningRuntime] = useState<string | null>(null)
  const [openRuntimeError, setOpenRuntimeError] = useState<string | null>(null)
  // 브라우저를 껐다 켜도 보던 탭에서 이어 하도록 마지막으로 본 탭을 기억한다.
  // 그 탭이 목록에서 사라졌으면(다른 창에서 닫았거나 저장분이 깨졌으면) 첫 탭으로 돌아간다
  const [activeId, setActiveId] = useState(() => loadActiveTabId(tabs, workspacePath))
  // 한 번이라도 연 탭만 붙인다 — 탭 하나가 에이전트 프로세스 하나라, 복원된 탭까지 다 띄우면 우르르 뜬다
  const [opened, setOpened] = useState<Set<string>>(() => new Set(!docked && activeId ? [activeId] : []))
  const [infos, setInfos] = useState<Record<string, TabInfo>>({})
  useEffect(() => {
    const running = tabs.filter(tab => allowAgent && tabsSynced && tab.runtime && tab.runtime !== 'tmux' && opened.has(tab.id) && infos[tab.id]?.busy).length
    onRunningAgentsChange?.(running)
  }, [allowAgent, tabsSynced, tabs, opened, infos, onRunningAgentsChange])
  useEffect(() => () => onRunningAgentsChange?.(0), [onRunningAgentsChange])
  const [infoTabs, setInfoTabs] = useState<Set<string>>(() => new Set())
  // 탭 상태 저장은 한 번에 하나만 보낸다. 빠른 이름·세션 갱신의 오래된 PUT이 늦게 도착해
  // 최신 thread 포인터를 되돌리는 경합을 막고, 대기 중에는 마지막 스냅샷만 남긴다.
  const pendingSaveRef = useRef<{ workspacePath: string; tabs: AgentTab[]; activeId: string | null } | null>(null)
  const saveRunningRef = useRef(false)
  // 탭을 닫을 때 그 탭의 WS로 close_session을 보내야 한다 — 창을 닫는 것과 달리 세션을 끝내는 뜻이다
  const sendersRef = useRef(new Map<string, (payload: Record<string, unknown>) => void>())

  // 셸/TUI 안의 Esc는 프로그램 입력이다. 터미널 밖에 포커스가 있을 때만 패널 닫기로 쓴다.
  useOverlayDismiss(!dock && onClose, { escapePhase: 'bubble', closeOnEscape: outsideTerminal })

  useEffect(() => {
    // 계정 원장이 SSoT이고 localStorage는 첫 화면용 fallback뿐이다. 전사·본문 캐시가 브라우저
    // quota를 채워도 이 보조 저장 실패가 서버 저장까지 막거나 React 루트를 내리면 안 된다.
    try { writeBrowserStorage(tabsKey, JSON.stringify(tabs)) } catch { /* 서버 원장 저장은 아래에서 계속한다 */ }
    if (!tabsSynced || !workspacePath) return
    pendingSaveRef.current = { workspacePath, tabs, activeId }
    if (saveRunningRef.current) return
    saveRunningRef.current = true
    const drain = async () => {
      while (pendingSaveRef.current) {
        const next = pendingSaveRef.current
        pendingSaveRef.current = null
        try {
          await saveAgentTabs(next.workspacePath, next)
        } catch (err) {
          console.error(err)
        }
      }
      saveRunningRef.current = false
    }
    void drain()
  }, [activeId, tabs, tabsKey, tabsSynced, workspacePath])

  useEffect(() => {
    let alive = true
    void resolveAgentCwd(workspacePath ?? '')
      .then(({ cwd }) => {
        if (!alive) return
        setDefaultCwd(cwd)
        setTabs((prev) => prev.map((tab) => tab.cwd == null ? { ...tab, cwd } : tab))
      })
      .catch((err: unknown) => {
        if (!alive) return
        setOpenRuntimeError(err instanceof Error ? err.message : String(err))
      })
    return () => { alive = false }
  }, [workspacePath])

  useEffect(() => {
    try {
      if (activeId) writeBrowserStorage(activeTabKey, activeId)
      else localStorage.removeItem(activeTabKey)
    } catch { /* 마지막 활성 탭도 계정 탭 상태에서 복원할 수 있다 */ }
  }, [activeId, activeTabKey])

  // 서버 저장값이 있으면 먼저 그것을 복원한다. 없을 때만 기존 localStorage 값이 위 effect를 통해
  // 계정 저장소의 첫 값이 된다. 따라서 빈 시크릿 창이 다른 기기의 탭을 지우지 않는다.
  useEffect(() => {
    if (!workspacePath) {
      setSessionClaims([])
      setTabsSynced(true)
      return
    }
    let alive = true
    setTabsSynced(false)
    const restoration = (preparedTabs ?? fetchAgentTabs(workspacePath))
      .then(({ state, claims }) => {
        if (alive) {
          setSessionClaims(claims)
        }
        if (!alive || !state) return
        const restoredTabs = state.tabs
          .filter((tab) => !(tab.runtime === null && tab.label === LEGACY_PENDING_TAB_LABEL))
          .filter((tab) => tab.runtime === null || tab.runtime === undefined || RUNTIMES.some((runtime) => runtime.id === tab.runtime))
          .map((tab) => tab.label === LEGACY_PENDING_TAB_LABEL && tab.runtime
            ? { ...tab, label: runtimeOf(tab.runtime).label, renamed: true }
            : tab)
        const restoredActiveId = state.activeId && restoredTabs.some((tab) => tab.id === state.activeId)
          ? state.activeId
          : (restoredTabs[0]?.id ?? null)
        pruneAgentLocalCaches(new Set([...claims.map((claim) => claim.tabId), ...restoredTabs.map((tab) => tab.id)]))
        setTabs(restoredTabs)
        setActiveId(restoredActiveId)
        setOpened(new Set(!docked && restoredActiveId ? [restoredActiveId] : []))
      })
      .catch(console.error)
      .finally(() => { if (alive) setTabsSynced(true) })
    if (trackRestore) void trackRestore(restoration)
    return () => { alive = false }
  }, [workspacePath, docked, preparedTabs, trackRestore])

  // Feature execution owns the host; opening its conversation only attaches the existing tab.
  useEffect(() => {
    if (!requestedTab || !tabsSynced || !allowAgent || requestedTab.cwd !== workspacePath) return
    setTabs(previous => previous.some(tab => tab.id === requestedTab.id) ? previous : [...previous, requestedTab])
    setActiveId(requestedTab.id)
    setOpened(previous => new Set(previous).add(requestedTab.id))
    setPickerOpen(false)
    const currentDock = latestDock.current
    const group = currentDock?.groupFor('agent', requestedTab.id) ?? 'agent'
    currentDock?.assign(group, requestedTab.id)
    currentDock?.select(group, requestedTab.id)
    onRequestedTabHandled?.()
  }, [requestedTab, onRequestedTabHandled, tabsSynced, allowAgent, workspacePath])

  const refreshSessionClaims = useCallback(async () => {
    if (!workspacePath) return
    try {
      const { claims } = await fetchAgentTabs(workspacePath)
      setSessionClaims(claims)
    } catch (err) {
      // 점유 새로고침이 잠깐 실패해도 히스토리 목록 자체는 기존 상태로 열어 둔다.
      console.error(err)
    }
  }, [workspacePath])

  const activate = (id: string) => {
    setPickerOpen(false)
    setActiveId(id)
    const tab = tabs.find((tab) => tab.id === id)
    if (dock && tab) dock.select(dock.groupFor(tab.runtime === 'tmux' ? 'terminal' : 'agent', id), id)
    setOpened((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }

  useEffect(() => {
    if (!requestedNoticeTab || !tabsSynced) return
    if (tabs.some(tab => tab.id === requestedNoticeTab)) {
      activate(requestedNoticeTab)
      onPanelFocus?.('agent')
    }
    onNoticeHandled?.()
  // activate reads the current dock and tabs; no websocket is recreated here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedNoticeTab, tabsSynced, tabs, onNoticeHandled])

  useEffect(() => { if (requestedPicker) { setPickerGroup('agent'); setPickerOpen(true) } }, [requestedPicker])

  const addTab = () => { setPickerGroup(focusedGroup); setPickerOpen(true) }

  const addRuntimeTab = (runtime: string, preset?: AgentTab['preset'], destination = runtime === 'tmux' ? 'terminal' : pickerGroup) => {
    if (openingRuntime) return
    setOpeningRuntime(runtime)
    setOpenRuntimeError(null)
    // workspacePath는 즉시 쓸 수 있지만 서버에서 실제 디렉터리인지 다시 확인한다. 최초 확인이
    // 일시적으로 실패했어도 "사용"을 다시 누르면 복구되며, null cwd 탭은 절대 만들지 않는다.
    void resolveAgentCwd(workspacePath ?? defaultCwd ?? '')
      .then(({ cwd }) => {
        const tab = newTab(runtime, preset?.name ?? runtimeOf(runtime).label, cwd, preset)
        setDefaultCwd(cwd)
        setTabs((prev) => [...prev, tab])
        setActiveId(tab.id)
        latestDock.current?.assign(destination, tab.id)
        setOpened((prev) => new Set(prev).add(tab.id))
        setPickerOpen(false)
        if (runtime !== 'tmux') onPickerRuntimeChosen?.(runtime)
      })
      .catch((err: unknown) => setOpenRuntimeError(err instanceof Error ? err.message : String(err)))
      .finally(() => setOpeningRuntime(null))
  }

  useEffect(() => {
    const open = (event: Event) => {
      const runtime = (event as CustomEvent<unknown>).detail
      if (typeof runtime === 'string' && runtimeOf(runtime).id === runtime) addRuntimeTab(runtime)
    }
    window.addEventListener('mew:open-agent-runtime', open)
    return () => window.removeEventListener('mew:open-agent-runtime', open)
  // addRuntimeTab deliberately reads current defaultCwd and creates a fresh tab for each settings click.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCwd])

  const addSetTab = (set: AgentSet, destination = pickerGroup) => {
    try { writeBrowserStorage(RUNTIME_KEY, set.runtime) } catch { /* 최근 런타임 기억은 선택을 막지 않는다 */ }
    addRuntimeTab(set.runtime, { id: set.id, name: set.name, modelId: set.modelId, thinkingId: set.thinkingId, thinkingConfigId: set.thinkingConfigId, role: set.role }, destination)
  }

  const closeTab = (id: string) => {
    const closing = tabs.find((tab) => tab.id === id)
    if (closing?.runtime && runtimeOf(closing.runtime).surface === 'terminal') {
      void stopAgentTerminal(closing.runtime, closing.id).catch(console.error)
    } else {
      if (allowTerminal) void stopAgentTabCommands(id).catch(console.error)
      sendersRef.current.get(id)?.({ type: 'close_session' })
    }
    clearAgentInputDraft(id)
    // unmount may flush the last events. Remove every runtime/cwd cache after it finishes.
    window.setTimeout(() => clearAgentTabCaches(id, cacheAccount), 0)
    const index = tabs.findIndex((tab) => tab.id === id)
    const rest = tabs.filter((tab) => tab.id !== id)
    // 닫은 자리의 오른쪽을 먼저 보여 주고, 끝 탭이면 왼쪽을 고른다. 아직 열어 보지 않은 탭도
    // 여기서 붙여야 활성 ID만 바뀌고 빈 화면으로 남지 않는다.
    const nextActiveId = rest[index]?.id ?? rest[index - 1]?.id ?? null
    setTabs(rest)
    setOpened((prev) => {
      const set = new Set(prev)
      set.delete(id)
      if (activeId === id && nextActiveId) set.add(nextActiveId)
      return set
    })
    setInfos((prev) => {
      const { [id]: _closed, ...keep } = prev
      return keep
    })
    setInfoTabs((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (activeId === id) {
      setActiveId(nextActiveId)
      if (!dock) setPickerOpen(nextActiveId === null)
    }
  }

  const panelGroups = dock ? [...new Set(['agent', 'terminal', ...tabs.map((tab) => dock.groupFor(tab.runtime === 'tmux' ? 'terminal' : 'agent', tab.id))])] : []
  const groupTabs = (group: string) => tabs.filter((tab) => dock?.groupFor(tab.runtime === 'tmux' ? 'terminal' : 'agent', tab.id) === group)
  const groupActive = (group: string) => { const list = groupTabs(group); return list.find((tab) => tab.id === dock?.state.active[group])?.id ?? list.find((tab) => tab.id === activeId)?.id ?? list[0]?.id ?? null }
  const focusedActiveId = dock ? groupActive(focusedGroup) : activeId
  const focusGroup = (group: string) => { setFocusedGroup(group); onPanelFocus?.(group.startsWith('terminal') ? 'terminal' : 'agent') }
  const visibleTabIds = dock ? panelGroups.filter((group) => group.startsWith('terminal') ? terminalOpen : agentOpen).map(groupActive).filter(Boolean).join('\0') : ''
  useEffect(() => {
    if (!tabsSynced || !visibleTabIds) return
    const ids = visibleTabIds.split('\0')
    setOpened((previous) => ids.every((id) => previous.has(id)) ? previous : new Set([...previous, ...ids]))
  }, [visibleTabIds, tabsSynced])

  // App은 키 조합만 판정하고, 실제 닫을 탭은 포커스된 표면이 맡는다.
  useFocusedShortcutScope(shortcutScopeRef, { closeTab: () => {
    if (!focusedActiveId) return false
    closeTab(focusedActiveId)
    return true
  } })

  // 화면 위 40% 좌우 스와이프로 탭 전환 — 터미널·에디터와 같은 손짓 (우→좌면 오른쪽 탭, 좌→우면 왼쪽 탭)
  const switchTab = (dir: 'left' | 'right') => {
    const list = dock ? groupTabs(focusedGroup) : tabs
    if (list.length < 2) return
    const idx = list.findIndex((tab) => tab.id === focusedActiveId)
    if (idx < 0) return
    const next = dir === 'left' ? (idx + 1) % list.length : (idx - 1 + list.length) % list.length
    activate(list[next].id)
  }
  const seenNextTabSignal = useRef(nextTabSignal)
  useEffect(() => {
    if (seenNextTabSignal.current === nextTabSignal) return
    seenNextTabSignal.current = nextTabSignal
    switchTab('left')
    // 이 signal이 바뀌는 순간에만 오른쪽 탭으로 한 칸 간다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextTabSignal])

  const seenCloseTabSignal = useRef(closeTabSignal)
  useEffect(() => {
    if (seenCloseTabSignal.current === closeTabSignal) return
    seenCloseTabSignal.current = closeTabSignal
    if (focusedActiveId) closeTab(focusedActiveId)
    // 이 signal이 바뀌는 순간의 활성 탭 하나만 닫는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeTabSignal])
  const seenPreviousTabSignal = useRef(previousTabSignal)
  useEffect(() => {
    if (seenPreviousTabSignal.current === previousTabSignal) return
    seenPreviousTabSignal.current = previousTabSignal
    switchTab('right')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousTabSignal])
  const register = useCallback((id: string, send: ((payload: Record<string, unknown>) => void) | null) => {
    if (send) sendersRef.current.set(id, send)
    else sendersRef.current.delete(id)
  }, [])

  const toggleInfo = useCallback((id: string) => {
    setInfoTabs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 대화에서 뽑은 이름 — 사람이 직접 붙인 이름은 건드리지 않는다(불러온 세션 제목도 여기로 온다)
  const setTabLabel = useCallback((id: string, label: string) => {
    setTabs((prev) => withAutoLabel(prev, id, label))
  }, [])

  const renameTab = useCallback((id: string, label: string) => {
    setTabs((prev) => withRename(prev, id, label))
  }, [])

  const labelProjectTab = useCallback((id: string, name: string) => {
    setTabs((prev) => withProjectLabel(prev, id, name))
  }, [])

  const reorderTabs = useCallback((from: number, to: number) => {
    setTabs((prev) => {
      const next = [...prev]
      next.splice(to, 0, ...next.splice(from, 1))
      return next
    })
  }, [])

  const setTabInfo = useCallback((id: string, runtime: string, cwd: string, info: TabInfo) => {
    setInfos((prev) =>
      prev[id]?.busy === info.busy && prev[id]?.sessionId === info.sessionId ? prev : { ...prev, [id]: info },
    )
    if (info.sessionId) { setTabs((prev) => withSessionId(prev, id, runtime, cwd, info.sessionId)); onRuntimeReady?.(runtime) }
  }, [onRuntimeReady])

  const forgetTabSession = useCallback((id: string, runtime: string, cwd: string) => {
    setTabs((prev) => withSessionId(prev, id, runtime, cwd, null))
  }, [])

  const renderSession = (tab: AgentTab, isActive: boolean, visible = isActive) => {
    if (tab.runtime === 'tmux' ? !allowTerminal : !allowAgent) return null
    if (tab.runtime && runtimeOf(tab.runtime).surface === 'terminal' && !allowTerminal) return <p className="p-3 text-sm text-ink-secondary">{t('access.terminalRequired')}</p>
    const resumeSessionId = sessionIdOf(tab, tab.runtime!, tab.cwd!) ?? null
    return (runtimeOf(tab.runtime!).surface === 'terminal' ? (
              <AgentTerminalView
                active={isActive}
                runtime={tab.runtime!}
                tabId={tab.id}
                cwd={tab.cwd!}
                activeFilePath={focusedFilePath}
                getSelectedText={getSelectedText}
                renderCommandButtons={tab.runtime === 'tmux' ? renderCommandButtons : undefined}
              />
            ) : <AgentSessionView
              key={cacheAccount}
              cacheAccount={cacheAccount}
              notificationWorkspace={workspacePath ?? tab.cwd!}
              notificationFocused={notificationFocused && agentOpen && isActive}
              allowTerminal={allowTerminal}
              tabId={tab.id}
              active={isActive}
              visible={visible}
              runtime={tab.runtime!}
              cwd={tab.cwd!}
              preset={tab.preset}
              resumeSessionId={resumeSessionId}
              project={project}
              tree={tree}
              focusedFilePath={focusedFilePath}
              infos={infos}
              takenSessionIds={[
                ...sessionClaims
                  .filter((claim) => claim.workspacePath !== workspacePath || claim.tabId !== tab.id)
                  .map((claim) => claim.sessionId),
                ...sessionIdsExcept(tabs, tab.id),
              ]}
              onRefreshSessionClaims={refreshSessionClaims}
              onLabel={setTabLabel}
              onProjectMention={labelProjectTab}
              onInfo={setTabInfo}
              onForgetSession={forgetTabSession}
              onRegister={register}
              onOpenFile={onOpenFile}
              onOpenGuidanceFile={onOpenGuidanceFile}
              onBackToPicker={() => { if (dock) setPickerGroup(dock.groupFor('agent', tab.id)); setPickerOpen(true) }}
              showInfo={isActive && infoTabs.has(tab.id)}
              onToggleInfo={() => toggleInfo(tab.id)}
            />)
  }
  if (dock) return <>
    {panelGroups.filter(group => group.startsWith('terminal') ? allowTerminal : allowAgent).map((group) => {
      const terminal = group.startsWith('terminal'), list = groupTabs(group), selected = groupActive(group)
      const picking = !terminal && ((pickerOpen && pickerGroup === group) || (tabsSynced && !tabs.some((tab) => tab.runtime !== 'tmux')))
      return <DockPanel key={group} id={group} tabs={list.map((tab) => tab.id)} kind={terminal ? 'terminal' : 'agent'} visible={(terminal ? terminalOpen : agentOpen) && (list.length > 0 || !tabs.some((tab) => (tab.runtime === 'tmux') === terminal))} onFocus={() => focusGroup(group)}>
        <AgentTabBar group={group} tabs={list} activeId={selected} pickerOpen={picking} infos={infos} onActivate={activate}
          onAdd={() => { focusGroup(group); if (terminal) addRuntimeTab('tmux', undefined, group); else { setPickerGroup(group); setPickerOpen(true) } }}
          onRename={renameTab} onReorder={(from, to) => { const a = tabs.findIndex((tab) => tab.id === list[from]?.id), b = tabs.findIndex((tab) => tab.id === list[to]?.id); if (a >= 0 && b >= 0) reorderTabs(a, b) }}
          onCloseTab={closeTab} onClosePanel={() => { if (!dock.desktop || !dock.closeGroup(group)) (terminal ? onCloseTerminal ?? onClose : onClose)() }} />
        {(!tabsSynced || picking || terminal && (!list.length || openRuntimeError)) && <DockInlineBody group={group} className="flex min-h-0 flex-1 flex-col bg-surface-deep">
        {!tabsSynced && (() => {
          return !terminal ? <AgentRestoringView /> : <div className="px-4 py-3 text-xs text-ink-muted" aria-busy="true">{uiText("불러오는 중…")}</div>
        })()}
        {tabsSynced && terminal && !list.length && <div className="flex min-h-0 flex-1 items-center justify-center"><button type="button" className="rounded-md border border-edge-bright px-4 py-2 text-sm text-ink-secondary hover:bg-surface-raised" onClick={() => { focusGroup(group); addRuntimeTab('tmux', undefined, group) }}>{uiText("새 터미널")}</button></div>}
        {picking && !terminal && <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          {openRuntimeError && <div role="alert" className="px-4 pt-3 text-xs text-danger">{openRuntimeError}</div>}
          {openingRuntime && <div className="px-4 pt-3 text-xs text-ink-muted">{uiText("{name} 여는 중…", { name: runtimeOf(openingRuntime).label })}</div>}
          <RuntimePicker onSelect={(runtime) => addRuntimeTab(runtime, undefined, group)} onSelectSet={(set) => addSetTab(set, group)} />
        </div>}
        {terminal && openRuntimeError && <div role="alert" className="px-4 py-3 text-xs text-danger">{openRuntimeError}</div>}
        </DockInlineBody>}
      </DockPanel>
    })}
    {tabsSynced && tabs.filter((tab) => (tab.runtime === 'tmux' ? allowTerminal : allowAgent) && tab.runtime && tab.cwd && opened.has(tab.id)).map((tab) => {
      const group = dock.groupFor(tab.runtime === 'tmux' ? 'terminal' : 'agent', tab.id)
      const active = (tab.runtime === 'tmux' ? terminalOpen : agentOpen) && groupActive(group) === tab.id && !(pickerOpen && pickerGroup === group)
      return <DockBody key={`${tab.id}:${tab.runtime}:${tab.cwd}`} group={group} active={active} onFocus={() => focusGroup(group)}>
        <AgentDockContent onClose={() => closeTab(tab.id)}>{renderSession(tab, active && focusedGroup === group, active)}</AgentDockContent>
      </DockBody>
    })}
  </>

  return (
    <div
      ref={shortcutScopeRef}
      className="flex h-full w-full flex-col bg-surface-deep"
      onMouseDown={dropOutsideFocus}
      onClick={dropInputFocusAfterPress}
    >
      <AgentTabBar
        tabs={tabs}
        activeId={activeId}
        pickerOpen={pickerOpen}
        infos={infos}
        onActivate={activate}
        onAdd={addTab}
        onRename={renameTab}
        onReorder={reorderTabs}
        onCloseTab={closeTab}
        onClosePanel={onClose}
      />
      {!tabsSynced && !pickerOpen && (() => {
        const tab = tabs.find((candidate) => candidate.id === activeId)
        return !tab?.runtime || runtimeOf(tab.runtime).surface !== 'terminal'
          ? <AgentRestoringView />
          : <div className="px-4 py-3 text-xs text-ink-muted" aria-busy="true">{uiText("대화 불러오는 중…")}</div>
      })()}
      {/* 안 보이는 탭도 붙어 있는 채로 둔다 — 돌고 있는 대화가 탭을 바꿨다고 멎으면 안 된다 */}
      {/* 서버 탭 상태를 확인하기 전에는 localStorage의 낡은 thread로 연결하지 않는다. */}
      {tabsSynced && tabs
        .filter((tab) => tab.runtime && tab.cwd && opened.has(tab.id))
        .map((tab) => {
          return (
          <div key={`${tab.id}:${tab.runtime}:${tab.cwd}`} className={!pickerOpen && tab.id === activeId ? 'min-h-0 flex-1' : 'hidden'}>
            {renderSession(tab, !pickerOpen && tab.id === activeId)}
          </div>
          )
        })}
      {pickerOpen && (
        <div className="flex min-h-0 flex-1 flex-col">
          {openRuntimeError && <div className="select-text shrink-0 px-4 pt-3 text-center text-xs text-danger">{openRuntimeError}</div>}
          {openingRuntime && <div className="shrink-0 px-4 pt-3 text-center text-xs text-ink-muted">{uiText("{name} 여는 중…", { name: runtimeOf(openingRuntime).label })}</div>}
          <RuntimePicker onSelect={addRuntimeTab} onSelectSet={addSetTab} />
        </div>
      )}
    </div>
  )
}

function AgentDockContent({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useUiLocale()
  const ref = useRef<HTMLDivElement>(null)
  useFocusedShortcutScope(ref, { closeTab: () => { onClose(); return true } })
  return <div ref={ref} className="flex h-full min-h-0 flex-col" onMouseDown={dropOutsideFocus} onClick={dropInputFocusAfterPress}>{children}</div>
}

/** 공식 CLI TUI를 탭별 tmux에 직접 붙인다. 본문·입력·모바일 키는 일반 터미널과 같은 구현이다. */
function AgentTerminalView({
  active,
  runtime,
  tabId,
  cwd,
  activeFilePath,
  getSelectedText,
  renderCommandButtons,
}: {
  active: boolean
  runtime: string
  tabId: string
  cwd: string
  activeFilePath: string | null
  getSelectedText?: () => string | null
  renderCommandButtons?: (run: (command: string) => void) => ReactNode
}) {
  useUiLocale()
  const { t } = useI18n()
  const [session, setSession] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let alive = true
    setSession(null)
    setError(null)
    void startAgentTerminal(runtime, tabId, cwd)
      .then((result) => { if (alive) setSession(result.session) })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
    return () => { alive = false }
  }, [cwd, retry, runtime, tabId])

  if (session) return <TmuxTerminal sessionName={session} inputPlaceholder={t('common.textInput')} activeFilePath={activeFilePath} getSelectedText={getSelectedText} renderCommandButtons={renderCommandButtons} insertRefTarget={active ? runtime === 'tmux' ? 'terminal' : 'agent' : null} />
  return (
    <div className="flex h-full items-center justify-center bg-surface-deep p-4 text-center">
      {error ? (
        <div className="space-y-3">
          <div className="select-text max-w-md whitespace-pre-wrap text-sm text-danger">{error}</div>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="rounded border border-edge-bright px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-raised">{uiText("다시 연결")}</button>
        </div>
      ) : <div className="text-sm text-ink-muted">{uiText("터미널 여는 중…")}</div>}
    </div>
  )
}

/** 서버 원장 확인 전부터 같은 로딩 화면을 사용한다. 캐시 전사는 세션 준비 뒤에만 표시한다. */
function AgentRestoringView() {
  const { t } = useI18n()
  return <div data-agent-restoring className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-busy="true">
    <div aria-hidden="true" className="h-8 shrink-0 border-b border-edge bg-surface" />
    <AgentLoadingBubbles label={t('common.loading')} />
  </div>
}

/** 탭 하나 — WS 하나, 세션 하나. 대화 상태는 전부 여기 안에 있다 */
function AgentSessionView({
  cacheAccount,
  visible,
  notificationFocused,
  notificationWorkspace,
  allowTerminal,
  tabId,
  active,
  runtime,
  cwd,
  preset,
  resumeSessionId,
  project,
  tree,
  focusedFilePath,
  infos,
  takenSessionIds,
  onRefreshSessionClaims,
  onLabel,
  onProjectMention,
  onInfo,
  onForgetSession,
  onRegister,
  onOpenFile,
  onOpenGuidanceFile,
  onBackToPicker,
  showInfo,
  onToggleInfo,
}: {
  cacheAccount: string
  notificationFocused: boolean
  notificationWorkspace: string
  allowTerminal: boolean
  tabId: string
  /** 입력·단축키 포커스 대상 */
  active: boolean
  /** 다른 패널에 포커스가 있어도 현재 표시 중인 탭은 로딩을 재생한다. */
  visible: boolean
  runtime: string
  cwd: string
  preset?: { id: string; name: string; thinkingId?: string; thinkingConfigId?: string; modelId: string; role: string }
  resumeSessionId: string | null
  project: string
  tree: TreeNode[]
  focusedFilePath: string | null
  infos: Record<string, TabInfo>
  /** mount 여부와 관계없이 다른 저장 탭이 기억하는 세션 */
  takenSessionIds: string[]
  onRefreshSessionClaims: () => Promise<void>
  onLabel: (tabId: string, label: string) => void
  onProjectMention: (tabId: string, name: string) => void
  onInfo: (tabId: string, runtime: string, cwd: string, info: TabInfo) => void
  onForgetSession: (tabId: string, runtime: string, cwd: string) => void
  onRegister: (tabId: string, send: ((payload: Record<string, unknown>) => void) | null) => void
  onOpenFile: OpenWorkspaceFile
  onOpenGuidanceFile?: (path: string) => void
  onBackToPicker: () => void
  showInfo: boolean
  onToggleInfo: () => void
}) {
  const uiLocale = useUiLocale()
  const { t } = useI18n()
  // 어느 프로젝트를 보고 있든 같은 창이다. 탭별 cwd는 워크스페이스 밖 경로도 될 수 있다(ADR 0077).
  const notificationFocusedRef = useRef(notificationFocused)
  notificationFocusedRef.current = notificationFocused
  const cacheKey = historyCacheKey(cacheAccount, runtime, tabId, cwd)
  const historyRef = useRef<CachedHistory | null>(null)
  const historyPendingRef = useRef(false)
  const cacheWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [historyStart, setHistoryStart] = useState(0)
  const [usersBefore, setUsersBefore] = useState(0)
  const prependScrollRef = useRef<{ height: number; top: number } | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [draft, setDraft] = useState(() => readAgentInputDraft(tabId))
  const [cliMode, setCliMode] = useState(false)
  const [commandPopupId, setCommandPopupId] = useState<string | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [attachments, setAttachments] = useState<AgentAttachment[]>([])
  const [previewAttachment, setPreviewAttachment] = useState<AgentAttachment | null>(null)
  const initialControls = useMemo(() => readAgentControlCache(runtime, tabId, cwd), [cwd, runtime, tabId])
  const [models, setModels] = useState<ModelState | null>(() => initialControls.models)
  const [modes, setModes] = useState<ModeState | null>(() => initialControls.modes)
  const [thinking, setThinking] = useState<ThinkingState | null>(() => initialControls.thinking)
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [meta, setMeta] = useState<SessionMeta | null>(null)
  const [cachedQueue, setCachedQueue] = useState<CachedQueue | null>(null)
  const cli = useAgentCommands({ runtime, cwd, sessionId: meta?.sessionId ?? resumeSessionId ?? '' }, allowTerminal)
  const commandPopup = cli.records.find(command => command.id === commandPopupId)
  useEffect(() => { if (!allowTerminal) setCliMode(false) }, [allowTerminal])
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [auth, setAuth] = useState<AgentAuthState | null>(null)
  const [authUrl, setAuthUrl] = useState<AgentAuthUrl | null>(null)
  const [authTerminal, setAuthTerminal] = useState<{
    session: string
    label: string
    methodId: string
    surface: 'browser' | 'terminal'
    verificationUrl: string | null
    verificationCode: string | null
    errorMessage: string | null
    state: 'running' | 'succeeded' | 'failed' | 'interrupted'
    exitCode: number | null
  } | null>(null)
  const [authBrowser, setAuthBrowser] = useState<{ methodId: string | null; browserTabId?: string; url: string; streamUrl: string } | null>(null)
  const authBrowserRef = useRef<typeof authBrowser>(null)
  const authBrowserOpeningRef = useRef(false)
  const [authTerminalOpen, setAuthTerminalOpen] = useState(false)
  const [loadingSession, setLoadingSession] = useState<string | null>(null)
  const [newConversationPending, setNewConversationPending] = useState(false)
  const [savedDefault, setSavedDefault] = useState<AgentRuntimeDefault | null>(null)
  const [savingDefault, setSavingDefault] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const wsRef = useRef<WebSocket | null>(null)
  const authBrowserDismissedRef = useRef(false)
  const pendingAcpUrlRef = useRef<string | null>(null)
  const acpBrowserTabsRef = useRef(new Set<string>())
  const closeAcpBrowserTabs = useCallback(() => {
    pendingAcpUrlRef.current = null
    for (const id of acpBrowserTabsRef.current) void closeServerBrowserTab(id).catch(() => {})
    acpBrowserTabsRef.current.clear()
  }, [])
  const closeAuthBrowser = useCallback(() => {
    authBrowserDismissedRef.current = true
    authBrowserOpeningRef.current = false
    authBrowserRef.current = null
    setAuthBrowser(null)
  }, [])
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const agentInputRef = useRef<MentionInputHandle>(null)
  const historyIndexRef = useRef<number | null>(null)
  const historyDraftRef = useRef('')
  const infoOverlayRef = useRef<HTMLDivElement>(null)
  const cacheSessionIdRef = useRef<string | null>(resumeSessionId)
  const resumeSessionIdRef = useRef<string | null>(resumeSessionId)
  const eventsRef = useRef(events)
  const replayRef = useRef<{
    events: AgentEvent[]
    restored: boolean
    restoreFailure: { sessionId: string; message: string } | null
  } | null>(null)
  const restoreFailureRef = useRef<{ sessionId: string; message: string } | null>(null)
  const adoptModels = useCallback((next: ModelState) => {
    setModels(next)
    writeAgentControlCache(runtime, tabId, cwd, { models: next })
  }, [cwd, runtime, tabId])
  const adoptModes = useCallback((next: ModeState) => {
    setModes(next)
    writeAgentControlCache(runtime, tabId, cwd, { modes: next })
  }, [cwd, runtime, tabId])
  const adoptThinking = useCallback((next: ThinkingState | null) => {
    setThinking(next)
    writeAgentControlCache(runtime, tabId, cwd, { thinking: next })
  }, [cwd, runtime, tabId])

  // Persist during normal operation; pagehide is only a best-effort extra flush.
  useEffect(() => {
    eventsRef.current = events
    if (cacheWriteTimerRef.current === null) cacheWriteTimerRef.current = setTimeout(() => {
      cacheWriteTimerRef.current = null
      if (historyRef.current) void writeHistoryCache(cacheKey, tabId, historyRef.current)
    }, 250)
  }, [cacheKey, events, tabId])
  useEffect(() => {
    const flush = () => { if (historyRef.current) void writeHistoryCache(cacheKey, tabId, historyRef.current) }
    window.addEventListener('pagehide', flush)
    window.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('visibilitychange', flush)
      if (cacheWriteTimerRef.current !== null) clearTimeout(cacheWriteTimerRef.current)
      cacheWriteTimerRef.current = null
      flush()
    }
  }, [cacheKey, tabId])

  // 에디터에서 누른 Ctrl+L의 `경로:줄` 참조를 입력창에 이어 붙인다. 창(App)이 마지막으로 연 보조창을
  // 골라 target을 실어 보내므로 에이전트 창 차례일 때만 받고, 탭이 여럿이면 **보이는 탭**만 받아 적는다
  useEffect(() => {
    const onInsertRef = (e: Event) => {
      const detail = (e as CustomEvent<{ target?: string; text: string }>).detail
      if (!active || detail.target !== 'agent') return
      setDraft((d) => d + detail.text)
    }
    window.addEventListener('mew:insert-ref', onInsertRef)
    return () => window.removeEventListener('mew:insert-ref', onInsertRef)
  }, [active])

  useEffect(() => {
    writeAgentInputDraft(tabId, draft)
  }, [draft, tabId])
  const scrollRef = useRef<HTMLDivElement>(null)
  const questionScrollRef = useRef<{ key: string; top: number } | null>(null)
  const sessionRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const composerActionsRef = useRef<HTMLDivElement>(null)
  const [minInputHeight, setMinInputHeight] = useState(0)
  useLayoutEffect(() => {
    const composer = composerRef.current
    const actions = composerActionsRef.current
    if (!composer || !actions) return
    const measure = () => {
      const style = getComputedStyle(composer)
      const actionsStyle = getComputedStyle(actions)
      const rows = Array.from(actions.children).filter(row => getComputedStyle(row).display !== 'none')
      const contentHeight = rows.reduce((height, row) => height + row.getBoundingClientRect().height, 0)
        + Math.max(0, rows.length - 1) * (parseFloat(actionsStyle.rowGap) || 0)
      const height = Math.ceil(contentHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth))
      setMinInputHeight(height)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(composer)
    for (const row of actions.children) observer.observe(row)
    measure()
    return () => observer.disconnect()
  }, [auth])
  // 탭을 바꾸거나 세션 뷰가 다시 붙어도 작성 영역이 최소 높이로 되돌아가지 않는다.
  const [inputHeight, setInputHeight] = useState(initialAgentInputHeight)
  const inputResizeCleanupRef = useRef<(() => void) | null>(null)
  // 지금 대화 바닥에 붙어 있는지 — 붙어 있을 때만 새 내용을 따라 내려간다
  const stickRef = useRef(true)
  const [unread, setUnread] = useState(false)
  const [viewportMetrics, setViewportMetrics] = useState(() => ({
    bottomInset: 0,
    maxInputHeight: agentInputMaxHeight(window.innerHeight),
  }))
  const maxInputHeight = viewportMetrics.maxInputHeight
  // 키보드가 닫히면 사용자가 정한 높이로 돌아가고, 열린 동안만 보이는 높이를 상한 안에 둔다.
  const visibleInputHeight = Math.max(minInputHeight, Math.min(inputHeight, maxInputHeight))

  // 키보드가 overlay로 뜨는 모바일에서는 session 높이가 바뀌지 않으므로, visual viewport에
  // 가려진 panel 하단을 직접 재서 composer 아래 여백으로 확보한다.
  useEffect(() => {
    if (!active) return
    let frame = 0
    const measure = () => {
      const bounds = sessionRef.current?.getBoundingClientRect()
      const panelHeight = Math.round(bounds?.height || window.innerHeight)
      const visualViewport = window.visualViewport
      const visibleBottom = visualViewport
        ? visualViewport.offsetTop + visualViewport.height
        : window.innerHeight
      const bottomGuard = isDesktop() ? 0 : MOBILE_AGENT_INPUT_BOTTOM_GUARD_PX
      const viewportOverlap = bounds ? Math.max(0, bounds.bottom - visibleBottom) : 0
      // 평상시에는 p-2만 남겨 네 방향 여백을 같게 한다. 안전 간격은 소프트 키보드가
      // 실제로 패널 아래를 덮을 때만 더한다.
      const coveredBottom = viewportOverlap > 0 ? viewportOverlap + bottomGuard : 0
      const bottomInset = Math.ceil(Math.min(Math.max(0, panelHeight - minInputHeight), coveredBottom))
      const scrollBounds = scrollRef.current?.getBoundingClientRect()
      const composerBounds = composerRef.current?.getBoundingClientRect()
      // 입력칸 앞의 실제 고정 영역을 잰다. 도구줄뿐 아니라 대기·예약 메시지가 생겨도
      // 그 높이를 입력칸 최대치에서 빼므로 composer가 panel 아래로 밀려나지 않는다.
      const fixedContentHeight = bounds && scrollBounds && composerBounds
        ? Math.max(0, composerBounds.top - bounds.top - scrollBounds.height)
        : 32
      const maxInputHeight = agentInputMaxHeight(panelHeight, bottomInset, fixedContentHeight, minInputHeight)
      setViewportMetrics((current) => current.maxInputHeight === maxInputHeight && current.bottomInset === bottomInset
        ? current
        : { maxInputHeight, bottomInset })
    }
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(measure)
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasure)
    if (sessionRef.current) observer?.observe(sessionRef.current)
    if (scrollRef.current) observer?.observe(scrollRef.current)
    if (composerRef.current) observer?.observe(composerRef.current)
    window.addEventListener('resize', scheduleMeasure)
    window.visualViewport?.addEventListener('resize', scheduleMeasure)
    window.visualViewport?.addEventListener('scroll', scheduleMeasure)
    measure()
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      window.visualViewport?.removeEventListener('resize', scheduleMeasure)
      window.visualViewport?.removeEventListener('scroll', scheduleMeasure)
    }
  // 인증 화면이 composer를 잠시 떼었다 다시 붙일 수 있어, 그 경계에서도 관찰 대상을 새로 잡는다.
  }, [active, auth, minInputHeight])

  const startInputResize = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    inputResizeCleanupRef.current?.()

    const pointerId = e.pointerId
    const startY = e.clientY
    // 조절 대상은 textarea만이 아니라 버튼까지 포함하는 composer 컨테이너다.
    // textarea는 그 안쪽 높이를 항상 전부 채운다.
    const startHeight = e.currentTarget.parentElement?.getBoundingClientRect().height
      ?? inputHeight
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      setInputHeight(resizedHeightFromTop(startHeight, startY, event.clientY, minInputHeight, maxInputHeight))
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      if (inputResizeCleanupRef.current === cleanup) inputResizeCleanupRef.current = null
    }
    const onEnd = (event: PointerEvent) => {
      if (event.pointerId === pointerId) cleanup()
    }
    inputResizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }, [inputHeight, maxInputHeight, minInputHeight])

  const resizeInputWithKeyboard = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const delta = e.key === 'ArrowUp' ? 12 : -12
    setInputHeight((height) => Math.min(maxInputHeight, Math.max(minInputHeight, height + delta)))
  }, [maxInputHeight, minInputHeight])

  /** 첫·마지막 시각적 줄에서만 터미널처럼 이전·다음 전송을 순회한다. */
  const navigateAgentHistory = useCallback((direction: 'up' | 'down'): boolean => {
    const input = agentInputRef.current
    if (!input || input.selectionStart !== input.selectionEnd) return false
    if (!input.isOnVisualBoundary?.(direction)) return false
    const history = readAgentInputHistory(tabId)
    if (history.length === 0) return false

    let index = historyIndexRef.current
    let next: string
    if (direction === 'up') {
      if (index === null) {
        historyDraftRef.current = draft
        index = history.length
      }
      index = Math.max(0, index - 1)
      next = history[index]
    } else {
      if (index === null) return false
      index += 1
      if (index >= history.length) {
        historyIndexRef.current = null
        next = historyDraftRef.current
      } else {
        historyIndexRef.current = index
        next = history[index]
      }
    }
    if (direction === 'up') historyIndexRef.current = index
    setDraft(next)
    requestAnimationFrame(() => {
      const textarea = agentInputRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(next.length, next.length)
    })
    return true
  }, [draft, tabId])

  useEffect(() => {
    try { writeBrowserStorage(AGENT_INPUT_HEIGHT_KEY, String(Math.round(inputHeight))) } catch { /* 저장 실패는 UI 동작에 영향 없다 */ }
  }, [inputHeight])

  useEffect(() => () => inputResizeCleanupRef.current?.(), [])

  // 들어오는 이벤트는 **한 프레임에 모아** 한 번만 그린다. 이벤트마다 setState하면 스트리밍 청크
  // 하나하나가 foldEvents 한 번 + 목록 전체 다시 그리기 한 번이 되어(청크는 초당 수십 개다) 창이 굳는다.
  const pendingRef = useRef<AgentEvent[]>([])
  const frameRef = useRef<number | null>(null)
  // 붙자마자 오는 첫 덩어리는 되감기다 — 지금 그린 대화에 **덧붙이지 말고 갈아끼운다**.
  // 새 서버는 replay 한 프레임으로 주고, 아직 재시작하지 않은 옛 서버는 이벤트를 하나씩 흘린다.
  // 이 스위치가 없으면 옛 서버에 다시 붙었을 때 대화가 두 벌로 이어 붙는다
  const swapRef = useRef(false)
  const queueEvent = useCallback((event: AgentEvent) => {
    pendingRef.current.push(event)
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      const batch = pendingRef.current
      if (batch.length === 0) return
      pendingRef.current = []
      // 갈아끼우기 여부는 여기서 소비한다 — setEvents 콜백 안에서 ref를 건드리면 순수하지 않다
      const swap = swapRef.current
      swapRef.current = false
      // reset도 순서대로 처리한다 — 히스토리를 불러올 때 "비우기"와 "새 대화"가 같은 프레임에 들어와
      // 중간의 빈 화면이 뜨지 않는다
      setEvents((prev) => {
        const next = swap ? [] : [...prev]
        for (const item of batch) {
          if (item.type === 'reset') next.length = 0
          else next.push(item)
        }
        return next
      })
    })
  }, [])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  useEffect(() => {
    let closed = false
    let retry: number | undefined
    let ws: WebSocket | undefined
    const target = { tabId, cwd, workspacePath: notificationWorkspace }
    const source = `${runtimeOf(runtime).label} · ${cwd.split('/').filter(Boolean).at(-1) ?? cwd}`
    const trackNotice = createAgentNoticeTracker(source, target)
    pendingRef.current = []
    replayRef.current = null
    // 연결·ACP 초기화보다 먼저 직전 값을 보여 주고, 아래 이벤트가 최신값으로 조용히 바꾼다.
    const cachedControls = readAgentControlCache(runtime, tabId, cwd)
    setModels(cachedControls.models)
    setModes(cachedControls.modes)
    setThinking(cachedControls.thinking)
    setMeta(null)
    setCachedQueue(null)
    setAuth(null)
    setAuthUrl(null)
    setAuthTerminal(null)
    setAuthTerminalOpen(false)
    setConnected(false)

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const query = new URLSearchParams({
        runtime,
        history: '1',
        ...(historyRef.current ? { generation: historyRef.current.generation, after: String(historyRef.current.end) } : {}),
        tab: tabId,
        cwd,
        ...(resumeSessionIdRef.current ? { resume: resumeSessionIdRef.current } : {}),
        ...(preset?.modelId ? { model: preset.modelId } : {}),
        ...(preset?.thinkingId && preset?.thinkingConfigId ? { thinking: preset.thinkingId, thinkingConfig: preset.thinkingConfigId } : {}),
        ...(preset?.role ? { role: preset.role } : {}),
      }).toString()
      ws = new WebSocket(`${proto}//${location.host}/api/agent/ws?${query}`)
      wsRef.current = ws
      ws.onopen = () => {
        // 다시 붙었다 — 다음에 오는 대화는 이어 붙이는 것이 아니라 지금 화면을 대신할 것이다
        swapRef.current = true
        setConnected(true)
      }
      ws.onmessage = (raw) => {
        let event = JSON.parse(String(raw.data)) as AgentEvent
        const sequenced = event.type === 'history_event'
        if (event.type === 'history') {
          historyPendingRef.current = false
          setLoadingSession(null)
          if (event.restoreFailure) {
            restoreFailureRef.current = event.restoreFailure
            replayRef.current = { events: [], restored: true, restoreFailure: event.restoreFailure }
            return
          }
          restoreFailureRef.current = null
          replayRef.current = null
          const next = mergeHistoryPage(historyRef.current, event.page)
          if (!next) {
            ws?.send(JSON.stringify({ type: 'history', range: {} }))
            return
          }
          if (event.page.mode === 'prepend' && scrollRef.current) {
            prependScrollRef.current = { height: scrollRef.current.scrollHeight, top: scrollRef.current.scrollTop }
          }
          historyRef.current = next
          clearAgentEventCache(runtime, tabId, cwd)
          cacheSessionIdRef.current = next.sessionId
          resumeSessionIdRef.current = next.sessionId
          setHistoryStart(next.start)
          setUsersBefore(next.usersBefore)
          pendingRef.current = []
          swapRef.current = false
          setEvents(next.events)
          for (const control of event.page.controls) {
            if (control.type === 'models') adoptModels(control.models)
            if (control.type === 'modes') adoptModes(control.modes)
            if (control.type === 'thinking') adoptThinking(control.thinking)
          }
          return
        }
        if (event.type === 'history_event') {
          if (restoreFailureRef.current) return
          const next = appendHistoryEvent(historyRef.current, event.event, event.position)
          if (!next) {
            if (!historyPendingRef.current) {
              historyPendingRef.current = true
              ws?.send(JSON.stringify({ type: 'history', range: {} }))
            }
            return
          }
          if (next === historyRef.current) return
          historyRef.current = next
          event = event.event
          queueEvent(event)
        }
        if (event.type === 'permission_done') resolveMewcatNotice(`${cwd}:${tabId}:permission:${event.id}`)
        const notice = trackNotice(event, notificationFocusedRef.current && document.visibilityState === 'visible' && document.hasFocus())
        if (notice) publishMewcatNotice(notice)
        if (event.type === 'ready') return
        if (event.type === 'models') return adoptModels(event.models)
        if (event.type === 'modes') return adoptModes(event.modes)
        if (event.type === 'thinking') return adoptThinking(event.thinking)
        if (event.type === 'meta') {
          setNewConversationPending(false)
          setCachedQueue(event.meta)
          if (!restoreFailureRef.current && !replayRef.current?.restoreFailure) void writeQueueCache(cacheKey, tabId, event.meta)
          const replayed = replayRef.current
          if (replayed) {
            replayRef.current = null
            if (replayed.restoreFailure) {
              // 자동 복원이 실패한 빈 fallback 세션은 원래 탭 포인터와 캐시를 대체하지 않는다.
              // 사용자가 새 메시지를 보내거나 다른 히스토리를 고를 때만 fallback을 채택한다.
              restoreFailureRef.current = replayed.restoreFailure
              const message = uiText("이전 대화를 불러오지 못했습니다. 다시 선택하거나 새 메시지로 시작하세요.\n{p0}", { p0: replayed.restoreFailure.message })
              setEvents((cached) => cached.some((item) => item.type === 'error' && item.message === message)
                ? cached
                : [...cached, { type: 'error', message }])
              return setMeta(event.meta)
            }
            const sameSession = cacheSessionIdRef.current === event.meta.sessionId
            setEvents((cached) => mergeAgentReplay(cached, replayed.events, sameSession, replayed.restored))
          } else if (cacheSessionIdRef.current && cacheSessionIdRef.current !== event.meta.sessionId) {
            // 인증 뒤 새 세션이 생긴 경우처럼 replay 없이 sessionId만 바뀌어도 옛 전사를 남기지 않는다.
            setEvents([])
          }
          cacheSessionIdRef.current = event.meta.sessionId
          resumeSessionIdRef.current = event.meta.sessionId
          return setMeta(event.meta)
        }
        if (event.type === 'auth') {
          setMeta(null)
          return setAuth({ methods: event.methods, authenticating: event.authenticating, error: event.error })
        }
        if (event.type === 'auth_url') return setAuthUrl({ id: event.id, url: event.url, message: event.message })
        if (event.type === 'auth_url_done') {
          if (runtime === 'antigravity' && event.id.startsWith('antigravity-oauth-')) {
            closeAuthBrowser()
            closeAcpBrowserTabs()
          }
          return setAuthUrl((current) => current?.id === event.id ? null : current)
        }
        if (event.type === 'auth_complete') {
          closeAuthBrowser()
          closeAcpBrowserTabs()
          setAuth(null)
          setAuthUrl(null)
          setAuthTerminalOpen(false)
          return setAuthTerminal(null)
        }
        if (event.type === 'sessions') return setSessions(event.sessions)
        // 재접속 되감기 — 지나간 대화가 한 덩어리로 온다. 그린 것을 통째로 갈아끼우므로 중간에 비지 않는다
        if (event.type === 'replay') {
          historyRef.current = null
          setHistoryStart(0)
          setUsersBefore(0)
          // Codex 히스토리 전환은 writer를 반납하려 어댑터를 교체하므로 reset이
          // 실시간 이벤트가 아니라 replay 안에 들어온다. replay 수신이 로딩의 종료다.
          setLoadingSession(null)
          // 모델·모드는 세션이 처음 뜨는 동안 이미 온다. 그 뒤 창이 붙으면 실시간 이벤트가
          // 아니라 replay 안에만 있으므로, 마지막 스냅샷을 상태로도 복원해야 상단 선택기가 산다.
          let foundModels = false
          let foundModes = false
          let foundThinking = false
          for (let i = event.events.length - 1; i >= 0 && (!foundModels || !foundModes || !foundThinking); i -= 1) {
            const replayed = event.events[i]
            if (replayed.type === 'models' && !foundModels) {
              adoptModels(replayed.models)
              foundModels = true
            }
            if (replayed.type === 'modes' && !foundModes) {
              adoptModes(replayed.modes)
              foundModes = true
            }
            if (replayed.type === 'thinking' && !foundThinking) {
              adoptThinking(replayed.thinking)
              foundThinking = true
            }
          }
          pendingRef.current = []
          swapRef.current = false
          // 바로 뒤따르는 meta의 sessionId를 보고 같은 세션인지 판정한 뒤 캐시와 합친다.
          replayRef.current = {
            events: event.events,
            restored: event.restored === true,
            restoreFailure: event.restoreFailure ?? null,
          }
          return
        }
        // 히스토리 불러오기 — 지금까지 그린 대화를 버린다. 새 대화는 바닥에서 시작한다.
        // 비우는 것 자체는 아래 줄 세우기가 순서대로 처리한다(뒤따라 오는 히스토리와 같은 프레임에 그려진다)
        if (event.type === 'reset') {
          historyRef.current = null
          historyPendingRef.current = false
          setHistoryStart(0)
          setUsersBefore(0)
          restoreFailureRef.current = null
          setLoadingSession(null)
          stickRef.current = true
        }
        // session/load가 reset 전에 실패하면 오류만 온다. 선택기를 계속 "불러오는 중"에 가두지 않는다.
        if (event.type === 'error') { historyPendingRef.current = false; setLoadingSession(null) }
        if (!sequenced) queueEvent(event)
      }
      ws.onclose = () => {
        if (closed) return
        historyPendingRef.current = false
        setConnected(false)
        // 대화는 지우지 않는다 — 잠깐 끊긴 사이 화면이 빈 탭(히스토리 드롭다운)으로 보이던 원인이다.
        // 다시 붙으면 서버가 보내는 replay가 통째로 갈아끼운다
        setMeta(null)
        retry = window.setTimeout(connect, 1000)
      }
    }
    let cacheDeadline: ReturnType<typeof setTimeout>
    void Promise.race([Promise.all([readHistoryCache(cacheKey), readQueueCache(cacheKey)]), new Promise<null>(resolve => { cacheDeadline = setTimeout(() => resolve(null), 200) })]).then(snapshot => {
      const [cached, queue] = snapshot ?? [null, null]
      clearTimeout(cacheDeadline)
      if (closed) return
      if (cached && cached.sessionId === resumeSessionIdRef.current && !historyRef.current) {
        historyRef.current = cached
        cacheSessionIdRef.current = cached.sessionId
        setHistoryStart(cached.start)
        setUsersBefore(cached.usersBefore)
        setEvents(cached.events)
      }
      if (queue?.sessionId === resumeSessionIdRef.current) setCachedQueue(queue)
      connect()
    })

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      ws?.close()
      wsRef.current = null
    }
    // 런타임을 바꾸면 저쪽 세션으로 갈아탄다 — 이쪽 세션은 서버에 그대로 남아 돌아오면 이어진다
    // (queueEvent는 값이 바뀌지 않는 useCallback이라 여기 있어도 재접속을 부르지 않는다)
  }, [cacheKey, runtime, tabId, cwd, notificationWorkspace, preset?.modelId, preset?.thinkingId, preset?.thinkingConfigId, preset?.role, queueEvent, adoptModels, adoptModes, adoptThinking, closeAuthBrowser, closeAcpBrowserTabs])

  // 경과 시간만 흐르게 한다 — 나머지 값은 서버 meta가 밀어 준다
  useEffect(() => {
    if (!showInfo) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [showInfo])

  const closeInfo = useCallback(() => {
    if (showInfo) onToggleInfo()
  }, [onToggleInfo, showInfo])
  // Info는 대화 흐름을 밀지 않는 팝업이다. 트리거까지 같은 경계에 넣어 버튼을 다시 눌러 닫을 수 있다.
  useOverlayDismiss(showInfo ? closeInfo : false, { outside: () => infoOverlayRef.current })

  const items = useMemo(() => foldEvents(events, uiLocale, historyStart), [events, uiLocale, historyStart])
  const timeline = useMemo(() => commandTimeline(items, cli.records.filter(command => command.state !== 'queued'), usersBefore), [items, cli.records, usersBefore])

  // 돌고 있는 턴의 걸린 시간을 1초마다 흘린다 — 끝난 턴은 서버가 새긴 durationMs로 고정이다
  const anyTurnRunning = items.some((item) => item.kind === 'turn' && !item.done)
  useEffect(() => {
    if (!anyTurnRunning) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [anyTurnRunning])

  // 대화가 자라도 **바닥에 붙어 있을 때만** 따라 내려간다 — 위로 올려 읽는 중(펼친 작업 버블을 읽는
  // 중이 대부분이다)이면 자리를 그대로 두고 "새 메시지"만 띄운다. 누르면 바닥으로 가고, 스스로
  // 바닥까지 내려가도 사라진다
  const scrollToBottom = useCallback(() => {
    questionScrollRef.current = null
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    stickRef.current = true
    setUnread(false)
  }, [])

  useLayoutEffect(() => {
    const anchor = prependScrollRef.current
    if (anchor && scrollRef.current) {
      scrollRef.current.scrollTop = anchor.top + scrollRef.current.scrollHeight - anchor.height
      prependScrollRef.current = null
    }
  }, [timeline])

  useEffect(() => {
    if (stickRef.current) scrollToBottom()
    else setUnread(true)
  }, [timeline, scrollToBottom])

  // 안 보이는 탭은 display:none이라 scrollHeight가 0이다 — 그동안 온 말은 못 따라 내려간 것이므로
  // 이 탭이 보이게 될 때 한 번 더 바닥으로 붙인다(위로 올려 두고 나간 탭은 그 자리를 지킨다)
  useEffect(() => {
    if (active && stickRef.current) scrollToBottom()
  }, [active, scrollToBottom])

  // 스트리밍으로 한두 줄씩 늘어나는 동안 붙었다 떨어졌다 하지 않게 바닥 판정에 여유를 둔다
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    if (questionScrollRef.current && Math.abs(questionScrollRef.current.top - el.scrollTop) > 1) questionScrollRef.current = null
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 48
    if (stickRef.current) setUnread(false)
    const history = historyRef.current
    if (el.scrollTop < 80 && history && history.start > 0 && !historyPendingRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      historyPendingRef.current = true
      wsRef.current.send(JSON.stringify({ type: 'history', range: { generation: history.generation, before: history.start } }))
    }
  }, [])

  const scrollToQuestion = useCallback((key: string) => {
    const el = scrollRef.current
    const question = el && [...el.querySelectorAll<HTMLElement>('[data-agent-question]')].find(node => node.dataset.agentQuestion === key)
    if (!el || !question) return
    const top = el.getBoundingClientRect().top + el.clientTop + parseFloat(getComputedStyle(el).paddingTop)
    el.scrollTo({ top: question.getBoundingClientRect().top - top + el.scrollTop, behavior: 'instant' })
    questionScrollRef.current = { key, top: el.scrollTop }
    handleScroll()
  }, [handleScroll])

  const navigateQuestion = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="listbox"], [role="slider"]')) return
    const el = event.currentTarget
    const questions = [...el.querySelectorAll<HTMLElement>('[data-agent-question]')]
    if (!questions.length) return
    const top = el.getBoundingClientRect().top + el.clientTop + parseFloat(getComputedStyle(el).paddingTop)
    const positions = questions.map(question => question.getBoundingClientRect().top - top + el.scrollTop)
    const last = questionScrollRef.current
    let selected = last && Math.abs(last.top - el.scrollTop) <= 1
      ? questions.findIndex(question => question.dataset.agentQuestion === last.key) : -1
    if (selected >= 0 && Math.abs(Math.min(positions[selected], el.scrollHeight - el.clientHeight) - el.scrollTop) > 1) selected = -1
    const up = event.key === 'ArrowUp'
    const index = selected >= 0
      ? Math.max(0, Math.min(questions.length - 1, selected + (up ? -1 : 1)))
      : up ? positions.findLastIndex(position => position < el.scrollTop - 1)
        : positions.findIndex(position => position > el.scrollTop + 1)
    event.preventDefault()
    event.stopPropagation()
    if (index < 0) return
    scrollToQuestion(questions[index].dataset.agentQuestion!)
  }, [scrollToQuestion])

  const send = useCallback((payload: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(payload))
  }, [])

  // 인증 명령의 exit code나 등록된 완료 파일 변경을 본다. 성공했을 때만 tmux를 닫고 ACP를 복구한다.
  // 내부 브라우저를 닫아도 로그인 명령과 감시는 계속된다.
  useEffect(() => {
    if (!authTerminal || authTerminal.state === 'failed' || authTerminal.state === 'interrupted') return
    const terminal = authTerminal
    let cancelled = false
    let timer: number | undefined
    const finish = async () => {
      closeAuthBrowser()
      await killTmuxSession(terminal.session).catch(() => {})
      if (cancelled) return
      setAuthTerminalOpen(false)
      setAuthTerminal(null)
      send({ type: 'retry_auth', methodId: terminal.methodId })
    }
    const poll = async () => {
      try {
        const status = await fetchAgentAuthTerminalStatus(runtime, tabId, terminal.methodId)
        if (cancelled) return
        if (terminal.surface === 'browser' && status.verificationUrl) {
          if (!authBrowserDismissedRef.current && !authBrowserRef.current && !authBrowserOpeningRef.current && !terminal.errorMessage && status.state === 'running') {
            authBrowserOpeningRef.current = true
            try {
              const page = await openAgentAuthServerBrowser(runtime, tabId, terminal.methodId)
              if (cancelled) return
              const next = { methodId: terminal.methodId, ...page }
              authBrowserRef.current = next
              setAuthBrowser(next)
            } catch (error) {
              if (cancelled) return
              setAuthTerminal((current) => current?.session === terminal.session
                ? { ...current, errorMessage: error instanceof Error ? error.message : String(error) } : current)
            } finally { authBrowserOpeningRef.current = false }
          }
        }
        if (status.state === 'succeeded') {
          await finish()
          return
        }
        if (status.state === 'failed' || status.state === 'interrupted') {
          closeAuthBrowser()
          setAuthTerminal((current) => current?.session === terminal.session ? { ...current, ...status } : current)
          return
        }
        setAuthTerminal((current) => current?.session === terminal.session ? { ...current, ...status } : current)
      } catch {
        // 잠깐의 HTTP 단절은 WS처럼 다음 poll에서 복구한다. 로그인 프로세스는 건드리지 않는다.
      }
      timer = window.setTimeout(poll, 750)
    }
    if (terminal.state === 'succeeded') void finish()
    else timer = window.setTimeout(poll, 400)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [authTerminal, closeAuthBrowser, runtime, send, tabId])

  // 에이전트 화면 종료 때 ACP 인증용 서버 탭을 정리한다.
  useEffect(() => closeAcpBrowserTabs, [closeAcpBrowserTabs])

  // 탭을 닫을 때 창이 이 탭의 WS로 close_session을 보낼 수 있게 보내는 손잡이를 올려 준다
  useEffect(() => {
    onRegister(tabId, send)
    return () => onRegister(tabId, null)
  }, [onRegister, send, tabId])

  // 탭 줄이 그리는 값(이름·진행 중)은 여기서 밀어 올린다 — 안 보고 있는 탭도 살아 있어야 한다
  useEffect(() => {
    onLabel(tabId, labelOf(items))
  }, [items, onLabel, tabId])

  useEffect(() => {
    if (restoreFailureRef.current) return
    onInfo(tabId, runtime, cwd, { busy: connected && ((meta?.busy ?? false) || cli.records.some(command => command.state === 'running')), sessionId: meta?.sessionId ?? '' })
  }, [connected, cwd, meta?.busy, meta?.sessionId, cli.records, onInfo, runtime, tabId])

  /** 다른 탭이 붙들고 있는 세션 — 이 탭에서 또 열지 못하게 막는다 */
  const takenIds = useMemo(
    () => [...new Set([
      ...takenSessionIds,
      ...Object.entries(infos)
        .filter(([id]) => id !== tabId)
        .map(([, info]) => info.sessionId)
        .filter(Boolean),
    ])],
    [infos, tabId, takenSessionIds],
  )

  const lastAccessError = events.findLast((event) => event.type === 'error' && event.accessIssue)
  const currentAccessIssue = meta ? meta.accessIssue : lastAccessError?.type === 'error' ? lastAccessError.accessIssue : null
  const busy = meta?.busy ?? false
  const queueMeta = meta ?? cachedQueue
  const queued = queueMeta?.queued ?? []
  const usage = meta?.usage ?? null

  // original = 고치기 시작할 때 보고 있던 원본. 서버가 이 항목을 잠가 앞 턴이 끝나도 큐를 당기지 않는다.
  const [expandedQueued, setExpandedQueued] = useState<{ index: number; text: string } | null>(null)
  const [editingQueued, setEditingQueued] = useState<QueuedEdit | null>(null)
  const [attachingQueued, setAttachingQueued] = useState(false)
  const queuedEditVersionRef = useRef(0)
  // 대기 큐 재정렬 — 편집 중에는 인덱스를 그대로 지켜야 하므로 큐 전체의 드래그를 잠시 막는다.
  const queueDrag = useGridDrag({
    enabled: connected && !!meta && queued.length > 1 && editingQueued === null,
    handleOnly: true,
    verticalList: true,
    onMove: (from, to) => send({ type: 'move_queued', from, to }),
  })
  const [errorDetail, setErrorDetail] = useState<{ title: string; detail: string } | null>(null)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const { scheduled, refresh: refreshScheduled, upsert: upsertScheduled, remove: removeScheduled } = useScheduledPrompts(cacheAccount, runtime, tabId, cwd, connected)
  const [editingScheduled, setEditingScheduled] = useState<{ id: string; text: string; original: string } | null>(null)
  const [rescheduling, setRescheduling] = useState<AgentScheduledPrompt | null>(null)
  const composerDraft = editingQueued?.text ?? draft
  const composerAttachments = editingQueued?.attachments ?? attachments
  const composerAttaching = editingQueued ? attachingQueued : attaching
  const composerCliMode = !editingQueued && cliMode
  const cliModeDisabled = !!editingQueued || !allowTerminal || attaching || attachments.length > 0 || cli.submitting
  const toggleCliMode = () => {
    if (cliModeDisabled) return
    setCliMode(value => !value)
    setScheduleOpen(false)
  }
  const startQueuedEdit = (index: number, text: string) => {
    if (!connected || !meta || editingQueued || text === '/clear' || queueMeta?.queuedKinds?.[index] === 'cli') return
    send({ type: 'begin_edit_queued', index, expect: text })
    queuedEditVersionRef.current++
    setScheduleOpen(false)
    setPreviewAttachment(null)
    requestAnimationFrame(() => agentInputRef.current?.focus())
    setEditingQueued({ index, text, original: text, settings: { ...messageSettings, ...queueMeta?.queuedSettings?.[index] }, attachments: (queueMeta?.queuedAttachments?.[index] ?? []).map(file => ({
      project: file.project, relPath: file.path, mimeType: file.mimeType,
      extension: attachmentExtension(file.path), isImage: file.mimeType.startsWith('image/'),
    })) })
  }
  const commitQueuedEdit = (edit: QueuedEdit) => {
    const text = edit.text.trim()
    if ((!text && !edit.attachments.length) || attachingQueued || !connected) return
    send({ type: 'edit_queued', index: edit.index, settings: edit.settings, text, expect: edit.original, skills: selectedSkillNames(text, skills), attachments: edit.attachments.map(queuedAttachmentInput) })
    queuedEditVersionRef.current++
    setPreviewAttachment(null)
    setEditingQueued(null)
    requestAnimationFrame(() => agentInputRef.current?.focus())
  }
  const cancelQueuedEdit = (edit: { index: number; original: string }) => {
    send({ type: 'cancel_edit_queued', index: edit.index, expect: edit.original })
    queuedEditVersionRef.current++
    setAttachingQueued(false)
    setPreviewAttachment(null)
    setEditingQueued(null)
    requestAnimationFrame(() => agentInputRef.current?.focus())
  }

  useOverlayDismiss(editingQueued ? () => cancelQueuedEdit(editingQueued) : false, {
    escapePhase: 'bubble',
    closeOnEscape: event => !event.defaultPrevented && !event.isComposing && !previewAttachment,
  })

  /**
   * 이 탭의 세션을 끝내고 새로 잡는다 — 탭은 그대로 두고 대화만 새 탭처럼 비운다.
   * 서버는 close_session을 받으면 세션을 접고 소켓을 닫는다. 아래 재접속(1초)이 같은 탭 id로 다시
   * 붙으면서 새 세션이 뜨고, 되감기가 빈 대화로 오므로 화면은 히스토리 드롭다운으로 돌아간다.
   * 끝난 세션은 사라지지 않는다 — 그 드롭다운에서 다시 불러올 수 있다.
   */
  const clearSession = useCallback(() => {
    // Idle conversations must disappear before storage or server cleanup runs.
    flushSync(() => {
      setNewConversationPending(!busy)
      restoreFailureRef.current = null
      resumeSessionIdRef.current = null
      cacheSessionIdRef.current = null
      historyRef.current = null
      historyPendingRef.current = false
      replayRef.current = null
      swapRef.current = false
      prependScrollRef.current = null
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      eventsRef.current = []
      pendingRef.current = []
      setHistoryStart(0)
      setUsersBefore(0)
      setLoadingSession(null)
      setEvents([])
      setMeta(null)
      setCachedQueue(null)
      setSessions(null)
      stickRef.current = true
      setUnread(false)
      onForgetSession(tabId, runtime, cwd)
    })
    send({ type: 'close_session' })
    clearAgentEventCache(runtime, tabId, cwd)
  }, [busy, cwd, onForgetSession, runtime, send, tabId])

  const submit = () => {
    if (editingQueued) {
      commitQueuedEdit(editingQueued)
      return
    }
    if (cliMode) {
      if (!allowTerminal || !draft.trim() || !connected || !meta?.sessionId || loadingSession || cli.submitting || attaching || attachments.length) return
      const command = draft
      void cli.submit(tabId, command, usersBefore + items.filter(item => item.kind === 'user').length).then(accepted => {
        if (!accepted) return
        recordAgentInputHistory(tabId, command)
        historyIndexRef.current = null
        historyDraftRef.current = ''
        setDraft(current => current === command ? '' : current)
        stickRef.current = true
      })
      return
    }
    const written = draft.trim()
    const refs = attachments.map((attachment) => `[[${attachment.project}:${attachment.relPath}]]`)
    const images = attachments.flatMap((attachment) => attachment.image ? [attachment.image] : [])
    const imageRefs = attachments.flatMap((attachment) => attachment.image
      ? [{ path: attachment.relPath, mimeType: attachment.image.mimeType }]
      : [])
    const text = [written, ...refs].filter(Boolean).join('\n')
    if (!text || !connected || loadingSession || attaching) return
    // CLI 슬래시 명령으로 넘기면 런타임은 세션을 비워도 Mew가 전사·캐시를 새 세션으로 바꿨다는
    // 사실을 알 수 없다. 서버 큐의 세션 경계로 처리해 뒤 메시지는 새 대화에서 실행한다.
    if (written === '/clear' && refs.length === 0) {
      send({ type: 'clear_session' })
      recordAgentInputHistory(tabId, written)
      historyIndexRef.current = null
      historyDraftRef.current = ''
      setDraft('')
      return
    }
    if (restoreFailureRef.current && meta?.sessionId) {
      // 복원 실패 후 사용자가 새 메시지를 보낸 것은 fallback 새 대화를 채택한다는 명시적 행동이다.
      restoreFailureRef.current = null
      resumeSessionIdRef.current = meta.sessionId
      cacheSessionIdRef.current = meta.sessionId
      clearAgentEventCache(runtime, tabId, cwd)
      historyRef.current = null
      setHistoryStart(0)
      setUsersBefore(0)
      eventsRef.current = []
      pendingRef.current = []
      setEvents([])
      onInfo(tabId, runtime, cwd, { busy: meta.busy, sessionId: meta.sessionId })
    }
    // 진행 중이어도 막지 않는다 — 서버가 줄을 세웠다가 턴이 끝나면 이어서 돈다
    send({ type: 'prompt', text, displayText: written, images, imageRefs, attachments: attachments.map(({ image: _image, ...file }) => queuedAttachmentInput(file)), skills: selectedSkillNames(text, skills), settings: messageSettings })
    recordAgentInputHistory(tabId, written)
    historyIndexRef.current = null
    historyDraftRef.current = ''
    setDraft('')
    setAttachments([])
    // 내가 말을 걸었으면 답을 보겠다는 뜻이다 — 다시 바닥에 붙인다
    stickRef.current = true
  }

  const attachFiles = useCallback(async (files: File[], target: 'composer' | 'queue' = 'composer') => {
    if ((target === 'queue' ? attachingQueued : attaching) || files.length === 0) return
    const version = queuedEditVersionRef.current
    if (target === 'queue') setAttachingQueued(true)
    else setAttaching(true)
    try {
      const saved: AgentAttachment[] = []
      // 서버가 이름 충돌을 순서대로 피하므로 동시에 올리지 않는다.
      for (const file of files) {
        const named = namedAttachment(file)
        const image = await imageForAgent(named)
        // 편집 중인 파일의 docs 스코프와 무관하게 현재 루트 프로젝트에 첨부한다.
        const { relPath } = await uploadInto(named, '.mew/assets', WORKSPACE_PROJECT)
        saved.push({ project: WORKSPACE_PROJECT, mimeType: named.type, relPath, extension: attachmentExtension(relPath), isImage: named.type.startsWith('image/'), image })
      }
      if (target === 'queue') {
        if (version === queuedEditVersionRef.current) {
          setEditingQueued(current => current ? { ...current, attachments: [...current.attachments, ...saved] } : current)
        }
      } else setAttachments((current) => [...current, ...saved])
    } catch (err) {
      setErrorDetail({ title: uiText("파일 첨부 실패"), detail: err instanceof Error ? err.message : String(err) })
    } finally {
      if (target === 'queue') {
        if (version === queuedEditVersionRef.current) setAttachingQueued(false)
      } else setAttaching(false)
    }
  }, [attaching, attachingQueued])

  const schedule = async (at: string) => {
    const refs = attachments.map((attachment) => `[[${attachment.project}:${attachment.relPath}]]`)
    const message = [draft.trim(), ...refs].filter(Boolean).join('\n')
    if (!message || !meta?.sessionId) throw new Error(uiText("세션을 준비한 뒤 예약하세요"))
    const { job } = await scheduleAgentPrompt({
      runtime,
      tab: tabId,
      cwd,
      sessionId: meta.sessionId,
      text: message,
      skills: selectedSkillNames(message, skills),
      at: new Date(at).toISOString(),
    })
    upsertScheduled(job)
    recordAgentInputHistory(tabId, draft.trim())
    historyIndexRef.current = null
    historyDraftRef.current = ''
    setDraft('')
    setAttachments([])
    await refreshScheduled().catch(() => {})
  }

  const cancelScheduled = async (id: string) => {
    try {
      await cancelAgentScheduledPrompt(id, { runtime, tab: tabId, cwd })
      removeScheduled(id)
      await refreshScheduled().catch(() => {})
    } catch (err) {
      setErrorDetail({ title: uiText("예약 메시지 취소 실패"), detail: err instanceof Error ? err.message : String(err) })
    }
  }

  const updateScheduled = async (job: AgentScheduledPrompt, text: string, at = job.at) => {
    const next = text.trim()
    if (!next) return
    const { job: updated } = await updateAgentScheduledPrompt(job.id, {
      runtime,
      tab: tabId,
      cwd,
      text: next,
      skills: selectedSkillNames(next, skills),
      at,
    })
    upsertScheduled(updated)
    await refreshScheduled().catch(() => {})
  }

  const commitScheduledEdit = (edit: { id: string; text: string; original: string }) => {
    const job = scheduled.find((item) => item.id === edit.id)
    if (job && edit.text.trim() && edit.text.trim() !== edit.original) {
      void updateScheduled(job, edit.text).catch((err) => {
        setErrorDetail({ title: uiText("예약 메시지 수정 실패"), detail: err instanceof Error ? err.message : String(err) })
      })
    }
    setEditingScheduled(null)
  }

  const pending = items.some((item) => item.kind === 'turn' && item.children.some((c) => c.kind === 'permission' && !c.answered))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = useCallback((key: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }), [])

  const currentRuntime = runtimeOf(runtime)
  const selectableModels = useMemo(() => panelModelState(runtime, models), [runtime, models])
  const currentModel = selectableModels?.availableModels.find((m) => m.modelId === selectableModels.currentModelId)?.name
  const modelOptions = selectableModels?.availableModels.map((m) => ({ id: m.modelId, label: m.name })) ?? [{ id: '', label: uiText("모델") }]
  const thinkingOptions = thinking?.options.map((option) => ({ id: option.id, label: option.name })) ?? [{ id: '', label: uiText("사고") }]
  const modeOptions = modes?.availableModes.map((mode) => ({ id: mode.id, label: MODE_LABEL[mode.id] ?? mode.name })) ?? [{ id: '', label: uiText("권한") }]
  const messageSettings = useMemo<AgentMessageSettings>(() => ({
    modelId: models?.currentModelId,
    thinkingId: thinking?.currentValue,
    thinkingConfigId: thinking?.configId,
    modeId: modes?.currentModeId,
    model: currentModel ?? models?.currentModelId ?? '—',
    thinking: thinking?.options.find((option) => option.id === thinking.currentValue)?.name ?? thinking?.currentValue ?? '—',
    permission: modes ? (MODE_LABEL[modes.currentModeId] ?? modes.currentModeId) : '—',
  }), [currentModel, models?.currentModelId, modes, thinking])
  const editingSettings = editingQueued?.settings
  const composerModelId = editingSettings?.modelId
    ? runtime === 'codex' ? splitCodexModelId(editingSettings.modelId).model : editingSettings.modelId
    : selectableModels?.currentModelId ?? ''
  const composerThinkingId = editingSettings?.thinkingId ?? thinking?.currentValue ?? ''
  const composerModeId = editingSettings?.modeId ?? modes?.currentModeId ?? ''
  const queueEfforts = editingQueued && runtime === 'codex' ? [...new Set(models?.availableModels.flatMap(item => {
    const { model, effort } = splitCodexModelId(item.modelId)
    return model === composerModelId && effort ? [effort] : []
  }) ?? [])] : []
  const composerThinkingOptions = queueEfforts.length ? queueEfforts.map(id => ({ id, label: thinkingOptions.find(option => option.id === id)?.label ?? id })) : thinkingOptions
  const editQueueModel = (modelId: string) => {
    setEditingQueued(current => {
      if (!current) return current
      let thinkingId = current.settings.thinkingId
      if (runtime === 'codex') {
        const variants = models?.availableModels.filter(item => splitCodexModelId(item.modelId).model === modelId) ?? []
        const selected = variants.find(item => splitCodexModelId(item.modelId).effort === thinkingId)
          ?? variants.find(item => splitCodexModelId(item.modelId).effort === 'medium') ?? variants[0]
        if (selected) { modelId = selected.modelId; thinkingId = splitCodexModelId(modelId).effort ?? thinkingId }
      }
      return { ...current, settings: { ...current.settings, modelId, thinkingId,
        model: modelOptions.find(option => option.id === (runtime === 'codex' ? splitCodexModelId(modelId).model : modelId))?.label ?? modelId,
        thinking: thinkingOptions.find(option => option.id === thinkingId)?.label ?? thinkingId ?? '—' } }
    })
  }
  const currentDefault = useMemo<AgentRuntimeDefault | null>(() => {
    const modelId = models?.currentModelId
    const modeId = modes?.currentModeId
    const thinkingId = thinking?.currentValue
    return modelId || thinkingId || modeId ? { ...(modelId ? { modelId } : {}), ...(thinkingId ? { thinkingId } : {}), ...(modeId ? { modeId } : {}) } : null
  }, [models?.currentModelId, modes?.currentModeId, thinking?.currentValue])
  const defaultIsSaved = currentDefault !== null
    && (savedDefault?.modelId ?? null) === (currentDefault.modelId ?? null)
    && (savedDefault?.thinkingId ?? null) === (currentDefault.thinkingId ?? null)
    && (savedDefault?.modeId ?? null) === (currentDefault.modeId ?? null)
  // meta가 오기 전 = 에이전트 프로세스가 아직 뜨는 중이다(질문은 그동안에도 받아 둔다 — 서버가 줄을 세운다)
  const status = !connected
    ? uiText("연결 중")
    : auth
      ? auth.authenticating ? uiText("로그인 확인 중") : uiText("로그인 필요")
      : !meta
      ? uiText("에이전트 준비 중")
      : loadingSession
        ? uiText("세션 불러오는 중")
        : pending
          ? uiText("승인 대기")
          : busy
            ? uiText("진행 중")
            : ''
  const totalTokens = usage ? usage.input + usage.output + usage.cacheWrite + usage.cacheRead : 0
  const conversationLoading = loadingSession !== null || (!newConversationPending && !historyRef.current && (!connected
    || (!meta && !auth && !events.some(event => event.type === 'error'))))
  useEffect(() => {
    let alive = true
    const load = () => fetchSkills(cwd, runtime)
      .then((res) => {
        if (alive) setSkills(res.skills)
      })
      .catch(() => {
        if (alive) setSkills([])
      })
    void load()
    window.addEventListener('mew:harness-changed', load)
    return () => {
      alive = false
      window.removeEventListener('mew:harness-changed', load)
    }
  }, [cwd, runtime])

  // @ 목록의 하위 프로젝트는 현재 파일 트리만으로는 빠질 수 있어, 역할별 워크스페이스
  // 프로젝트 목록도 함께 쓴다(/api/projects).
  useEffect(() => {
    let alive = true
    fetchProjects()
      .then((items) => {
        if (alive) setProjects(items)
      })
      .catch(() => {
        if (alive) setProjects([])
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    fetchAgentDefault(runtime)
      .then(({ settings }) => {
        if (alive) setSavedDefault(settings)
      })
      .catch(() => {
        if (alive) setSavedDefault(null)
      })
    return () => {
      alive = false
    }
  }, [runtime])

  const saveCurrentDefault = () => {
    if (!currentDefault || savingDefault) return
    setSavingDefault(true)
    saveAgentDefault(runtime, currentDefault)
      .then(({ settings }) => setSavedDefault(settings))
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : String(err)
        setErrorDetail({ title: uiText("에이전트 기본값 저장 실패"), detail })
      })
      .finally(() => setSavingDefault(false))
  }

  const [mentionTrigger, setMentionTrigger] = useState<string | null>(null)
  const [documentsMentionTree, setDocumentsMentionTree] = useState<TreeNode[]>([])
  useEffect(() => {
    setDocumentsMentionTree([])
    if (mentionTrigger !== '@' || cliMode || !active) return
    let controller: AbortController | null = null
    const refresh = () => {
      controller?.abort()
      const request = new AbortController()
      controller = request
      setDocumentsMentionTree([])
      // Documents is a separate API scope, independent of the selected editor tab.
      // Read the complete tree only while @ is open, including collapsed folders.
      void fetchFullTree('docs', request.signal).then(nodes => {
        if (!request.signal.aborted) setDocumentsMentionTree(nodes)
      }).catch(() => { /* Keep existing project candidates; reopening @ retries. */ })
    }
    refresh()
    window.addEventListener('mew:permissions-changed', refresh)
    return () => { controller?.abort(); window.removeEventListener('mew:permissions-changed', refresh) }
  }, [mentionTrigger, cliMode, active, notificationWorkspace])

  const fileMentionOptions = useMemo<MentionOption[]>(
    () => agentInputMentionOptions(tree, project, projects, focusedFilePath, documentsMentionTree, uiLocale),
    [tree, project, projects, focusedFilePath, documentsMentionTree, uiLocale],
  )
  const slashTriggers = useMemo<TriggerOptionSet[]>(
    () => [
      {
        trigger: '/',
        options: skills.map((skill) => ({
          id: skill.name,
          label: skill.name,
          hint: skill.description,
          insert: `/${skill.name}`,
        })),
      },
    ],
    [skills],
  )
  const mentionTriggers = useMemo<TriggerOptionSet[]>(
    () => slashTriggers,
    [slashTriggers],
  )

  return (
    <div ref={sessionRef} data-agent-session className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-deep">
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
      {/* 탭바 바로 아래의 세션 도구 바. 히스토리·정보 팝업만 이 바에서 펼친다. */}
      <div ref={infoOverlayRef} inert={!connected} className="relative z-20 flex h-8 shrink-0 items-center justify-between border-b border-edge bg-surface px-3">
        <SessionPicker
          sessions={sessions}
          takenIds={takenIds}
          currentSessionId={meta?.sessionId ?? null}
          loadingSession={loadingSession}
          hasConversation={items.length > 0}
          disabled={!connected}
          loadDisabledReason={!meta?.canLoad
            ? t('agent.history.unsupported')
            : busy || pending || (meta?.queued.length ?? 0) > 0
              ? t('agent.history.wait')
              : undefined}
          onOpen={async () => {
            // 열 때마다 새로 물어본다 — 그 사이 다른 탭에서 돈 대화가 목록에 있어야 한다.
            setSessions(null)
            await onRefreshSessionClaims()
            send({ type: 'list_sessions' })
          }}
          onPick={(session) => {
            setLoadingSession(session.sessionId)
            onLabel(tabId, session.title || session.sessionId.slice(0, 8))
            send({ type: 'load_session', sessionId: session.sessionId })
          }}
          // 새 대화는 작업·큐 상태와 관계없이 현재 세션을 바로 닫는다.
          onNewConversation={clearSession}
          refreshDisabled={busy || (meta?.queued.length ?? 0) > 0 || takenIds.includes(meta?.sessionId ?? '')}
          onRefresh={runtime === 'codex' && meta?.canLoad ? () => {
            if (!meta.sessionId) return
            setLoadingSession(meta.sessionId)
            send({ type: 'load_session', sessionId: meta.sessionId })
          } : undefined}
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => send({ type: 'clear_session' })}
            disabled={!connected}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink disabled:opacity-40"
            aria-label={uiText("대화 비우기")}
            title={uiText("대화 비우기 (/clear)")}
          >
            <ClearGlyph />
          </button>
          <button
            type="button"
            onClick={onToggleInfo}
            disabled={!connected}
            className={`flex h-6 w-6 items-center justify-center rounded hover:bg-surface-hover hover:text-ink disabled:opacity-40 ${
              showInfo ? 'bg-surface-hover text-ink' : 'text-ink-secondary'
            }`}
            aria-label={uiText("세션 정보 · 계정 · 사용량")}
            aria-expanded={showInfo}
            title={uiText("세션 정보 · 계정 · 사용량")}
          >
            <InfoGlyph />
          </button>
          <AgentHarnessButtons cwd={cwd} />
          {onOpenGuidanceFile && <AgentGuidanceButton onOpenFile={onOpenGuidanceFile} />}
          <AgentQuotaBattery runtime={runtime} account={cacheAccount} enabled={visible && connected && !auth} />
        </div>

        {showInfo && (
          <div className="absolute right-3 top-full mt-1 max-h-[60dvh] w-[min(23rem,calc(100%-1.5rem))] space-y-1 overflow-y-auto overscroll-contain rounded-lg border border-edge-bright bg-surface p-3 text-xs shadow-xl">
          <InfoRow label={uiText("세션 ID")} value={meta ? meta.sessionId.slice(0, 8) : '—'} title={meta?.sessionId} />
          <InfoRow
            label={uiText("시작")}
            value={meta ? `${formatTime(meta.startedAt)} · ${formatElapsed(meta.startedAt, now)}` : '—'}
          />
          {status && <InfoRow label={uiText("상태")} value={status} />}
          <InfoRow label={uiText("모델")} value={currentModel ?? models?.currentModelId ?? '—'} />
          <InfoRow
            label={uiText("권한 모드")}
            value={modes ? (MODE_LABEL[modes.currentModeId] ?? modes.currentModeId) : '—'}
          />
          <InfoRow label={uiText("추론 정도")} value={thinking?.options.find((option) => option.id === thinking.currentValue)?.name ?? thinking?.currentValue ?? '—'} />
          <InfoRow label={uiText("대화 턴")} value={meta ? uiText("{p0}턴", { p0: nf.format(meta.turns) }) : '—'} />
          {usage ? (
            <>
              {/* 줄인 값이 화면에 나가고, 정확한 자릿수는 title로 남긴다 */}
              <InfoRow label={uiText("컨텍스트")} value={uiText("{p0} 토큰", { p0: tf.format(usage.context) })} title={uiText("{p0} 토큰", { p0: nf.format(usage.context) })} />
              <InfoRow
                label={uiText("입력 / 출력")}
                value={`${tf.format(usage.input)} / ${tf.format(usage.output)}`}
                title={`${nf.format(usage.input)} / ${nf.format(usage.output)}`}
              />
              <InfoRow
                label={uiText("캐시 (쓰기/읽기)")}
                value={`${tf.format(usage.cacheWrite)} / ${tf.format(usage.cacheRead)}`}
                title={`${nf.format(usage.cacheWrite)} / ${nf.format(usage.cacheRead)}`}
              />
              <InfoRow label={uiText("전체 토큰")} value={uiText("{p0} 토큰", { p0: tf.format(totalTokens) })} title={uiText("{p0} 토큰", { p0: nf.format(totalTokens) })} />
              {/* 구독제(Claude Code)로 돌면 실제로 나가는 돈이 아니다 — 같은 토큰의 API 정가 환산값이다 */}
              <InfoRow
                label={uiText("API 환산 비용")}
                // 서버가 아직 안 올라왔으면 cost 자체가 없다 — 없는 값에 toFixed를 걸어 패널이 죽지 않게 한다
                value={typeof usage.cost === 'number' ? formatUsd(usage.cost) : uiText("값 없는 모델")}
                title={uiText("API 요금 기준 추정치 · 실제 청구액 아님")}
              />
            </>
          ) : (
            <InfoRow label={uiText("토큰")} value={uiText("기록 없음")} />
          )}
          {!auth && Object.hasOwn(SUBSCRIPTION_URLS, runtime) && <AgentAccountCard key={runtime} runtime={runtime} issue={currentAccessIssue} queued={!!meta?.queued.length} embedded />}
          </div>
        )}
      </div>

      {auth ? authBrowser ? (
        <AgentAuthServerBrowser
          runtime={currentRuntime.label}
          page={authBrowser}
          onReady={() => {
            const id = pendingAcpUrlRef.current
            if (id) { pendingAcpUrlRef.current = null; send({ type: 'auth_url_response', id, action: 'accept' }) }
          }}
          onPopup={(id) => { if (!authBrowser.methodId) acpBrowserTabsRef.current.add(id) }}
          verificationCode={authTerminal?.verificationCode ?? null}
          reopen={async () => authBrowser.methodId
            ? (await openAgentAuthServerBrowser(runtime, tabId, authBrowser.methodId)).streamUrl
            : (await openServerBrowserTab(authBrowser.browserTabId!, authBrowser.url)).streamUrl}
          onClose={closeAuthBrowser}
        />
      ) : (
        <AgentAuthPanel
          runtime={currentRuntime.label}
          state={auth}
          urlRequest={authUrl}
          onAuthenticate={(methodId, secret) => send({ type: 'authenticate', methodId, ...(secret ? { secret } : {}) })}
          onOpenUrl={(request) => {
            if (authBrowserOpeningRef.current) return
            authBrowserOpeningRef.current = true
            pendingAcpUrlRef.current = request.id
            const browserTabId = crypto.randomUUID()
            void openServerBrowserTab(browserTabId, request.url).then((page) => {
              if (pendingAcpUrlRef.current !== request.id) { void closeServerBrowserTab(page.id).catch(() => {}); return }
              acpBrowserTabsRef.current.add(page.id)
              const next = { methodId: null, browserTabId: page.id, url: page.url, streamUrl: page.streamUrl }
              authBrowserDismissedRef.current = false
              authBrowserRef.current = next
              setAuthBrowser(next)
            }).catch((error: unknown) => setErrorDetail({ title: uiText("로그인 페이지를 열지 못했습니다"), detail: error instanceof Error ? error.message : String(error) }))
              .finally(() => { authBrowserOpeningRef.current = false })
          }}
          onCancelUrl={(id) => { pendingAcpUrlRef.current = null; closeAcpBrowserTabs(); send({ type: 'auth_url_response', id, action: 'cancel' }) }}
          onBackToPicker={() => {
            closeAuthBrowser()
            closeAcpBrowserTabs()
            onBackToPicker()
          }}
          browserLoginUrl={authTerminal?.verificationUrl ?? null}
          browserLoginCode={authTerminal?.verificationCode ?? null}
          browserLoginInput={auth.methods.find((method) => method.id === authTerminal?.methodId)?.browserInput ?? null}
          browserLoginPreparing={authTerminal?.surface === 'browser' && authTerminal.state === 'running' && !authTerminal.verificationUrl}
          browserLoginError={authTerminal?.surface === 'browser' && authTerminal.state === 'failed'
            ? authTerminal.errorMessage ?? uiText("로그인하지 못했습니다. 다시 시도하세요.")
            : authTerminal?.surface === 'browser' && authTerminal.state === 'interrupted'
              ? uiText("로그인이 중단됐습니다. 다시 시도하세요.")
              : authTerminal?.surface === 'browser' ? authTerminal.errorMessage : null}
          onOpenBrowserLogin={() => {
            const url = authTerminal?.verificationUrl
            if (!url || !authTerminal) return
            authBrowserDismissedRef.current = false
            authBrowserOpeningRef.current = true
            void openAgentAuthServerBrowser(runtime, tabId, authTerminal.methodId)
              .then((page) => {
                const next = { methodId: authTerminal.methodId, ...page }
                authBrowserRef.current = next
                setAuthBrowser(next)
                setAuthTerminal((current) => current ? { ...current, errorMessage: null } : current)
              })
              .catch((error: unknown) => setAuthTerminal((current) => current
                ? { ...current, errorMessage: error instanceof Error ? error.message : String(error) }
                : current))
              .finally(() => { authBrowserOpeningRef.current = false })
          }}
          onSubmitBrowserLoginInput={(input) => {
            if (!authTerminal) return Promise.reject(new Error(uiText("진행 중인 로그인 작업이 없습니다")))
            return submitAgentAuthBrowserInput(runtime, tabId, authTerminal.methodId, input).then(() => undefined)
          }}
          onOpenTerminal={(methodId) => {
            void runAgentAuthTerminal(runtime, tabId, cwd, methodId)
              .then(({ session, label, state, exitCode }) => {
                setAuthTerminal({ session, label, methodId, surface: 'terminal', verificationUrl: null, verificationCode: null, errorMessage: null, state, exitCode })
                setAuthTerminalOpen(true)
              })
              .catch((err: unknown) => setErrorDetail({
                title: uiText("로그인 터미널을 열지 못했습니다"),
                detail: err instanceof Error ? err.message : String(err),
              }))
          }}
          onStartBrowserLogin={(methodId) => {
            closeAuthBrowser()
            authBrowserDismissedRef.current = false
            void runAgentAuthTerminal(runtime, tabId, cwd, methodId)
              .then(({ session, label }) => {
                // 명령이 즉시 실패해 POST 응답이 이미 failed여도 상태 endpoint를 한 번 읽어야
                // 터미널을 숨긴 브라우저형 로그인에서 공급자의 안전한 실패 이유를 보여 줄 수 있다.
                setAuthTerminal({ session, label, methodId, surface: 'browser', verificationUrl: null, verificationCode: null, errorMessage: null, state: 'running', exitCode: null })
              })
              .catch((err: unknown) => {
                setErrorDetail({
                  title: uiText("브라우저 로그인을 시작하지 못했습니다"),
                  detail: err instanceof Error ? err.message : String(err),
                })
              })
          }}
        />
      ) : (
        <>
      <div data-agent-conversation aria-busy={conversationLoading} className="relative isolate flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} tabIndex={0} onKeyDown={navigateQuestion} onScroll={handleScroll}
        onClick={event => {
          if (event.detail > 0 && event.target instanceof Element && !event.target.closest('a, input, textarea, select, [contenteditable]:not([contenteditable="false"])')) event.currentTarget.focus({ preventScroll: true })
        }}
        inert={conversationLoading} style={{ visibility: conversationLoading ? 'hidden' : undefined }} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink">
        {!conversationLoading && timeline.length === 0 && (
          <div className="flex min-h-full items-center justify-center text-center text-ink-muted">
            {t('agent.emptyConversation')}
          </div>
        )}
        {timeline.map((item, index) => {
          if (item.kind === 'command') return <AgentCommandBubble key={item.key} command={item.command} onOpen={() => setCommandPopupId(item.command.id)} />
          if (item.kind === 'user') {
            // 내가 쓴 말이라 이미 아는 내용이다 — 턴 버블과 같게 접어 두고, 눌러야 다 보인다
            const open = expanded.has(item.key)
            return (
              <div key={item.key} data-agent-question={item.key} className="space-y-2">
                {item.settings && (() => {
                  const previous = timeline.slice(0, index).reverse().find((candidate) => candidate.kind === 'user')
                  const changed = previous?.kind !== 'user'
                    || previous.settings?.model !== item.settings.model
                    || previous.settings?.thinking !== item.settings.thinking
                    || previous.settings?.permission !== item.settings.permission
                  return changed ? (
                    <div className="flex items-center gap-2 py-0.5 text-[11px] text-ink-muted" aria-label={uiText("실행 설정: {p0} · {p1} · {p2}", { p0: item.settings.model, p1: item.settings.thinking, p2: item.settings.permission })}>
                      <span className="h-px flex-1 bg-edge" />
                      <span className="shrink-0">{item.settings.model} · {item.settings.thinking} · {item.settings.permission}</span>
                      <span className="h-px flex-1 bg-edge" />
                    </div>
                  ) : null
                })()}
                {/* 설정줄은 작업 버블과 같은 전체 폭, 사용자 발화만 오른쪽으로 들여쓴다. */}
                <div className="ml-6 space-y-2">
                {item.images.length > 0 && (
                  <div className="flex flex-col items-end gap-2" aria-label={uiText("첨부 사진 {p0}장", { p0: item.images.length })}>
                    {item.images.map((image, index) => (
                      <a
                        key={`${image.path}-${index}`}
                        href={rawUrl(image.path, project)}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-lg bg-surface-raised"
                        title={uiText("사진 크게 보기")}
                      >
                        <img
                          src={rawUrl(image.path, project)}
                          alt={uiText("첨부한 사진")}
                          className="max-h-64 max-w-56 object-contain"
                        />
                      </a>
                    ))}
                  </div>
                )}
                {item.text && (
                  <div className="flex items-start rounded-lg rounded-tr-none bg-surface-raised">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => {
                        if (hasSelection()) return
                        toggle(item.key)
                      }}
                      className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left text-ink"
                    >
                      <span className={`min-w-0 flex-1 break-words [overflow-wrap:anywhere] select-text ${open ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>{item.text}</span>
                    </button>
                    <CopyButton text={item.text} label={uiText("이 질문 복사")} />
                  </div>
                )}
                </div>
              </div>
            )
          }
          if (item.kind === 'turn') {
            const open = expanded.has(item.key)
            const question = timeline.slice(0, index).findLast(candidate => candidate.kind === 'user')
            const state = turnState(item, meta?.activeTask === 'cli' ? false : meta?.busy ?? null)
            // 마지막 답변을 패널 폭에 맞춰 두 줄로 요약한다.
            const lastAgent = [...item.children].reverse().find((c) => c.kind === 'agent')
            const summary = lastAgent && lastAgent.kind === 'agent'
              ? lastAgent.text
              : state === 'cancelled'
                ? uiText("중단됨")
                : state === 'failed'
                  ? uiText("실패함")
                  : state === 'done'
                    ? uiText("완료")
                    : uiText("작업 중…")
            const answerText = item.children
              .filter((c) => c.kind === 'agent')
              .map((c) => (c.kind === 'agent' ? c.text : ''))
              .join('\n\n')
            // 걸린 시간 — 끝난 턴은 서버가 새긴 durationMs, 돌고 있는 턴은 startedAt부터 지금까지(now가 1초마다 흘러 갱신)
            const durationMs = item.done
              ? item.durationMs
              : item.startedAt != null
                ? Math.max(0, now - item.startedAt)
                : null
            const canStop = busy && meta?.activeTask !== 'cli' && !item.done
            const actionSpace = Math.max(0, (Number(Boolean(answerText.trim())) + Number(canStop)) * 36 - 6)
            return (
              <div key={item.key} className="rounded-lg rounded-tl-none border border-edge bg-surface">
                <div data-agent-turn-header className={`min-h-9 ${open ? 'sticky -top-3 z-10 flex rounded-tr-lg border-b border-edge bg-surface' : 'relative'}`}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => {
                      if (hasSelection()) return
                      toggle(item.key)
                    }}
                    className={`flex min-w-0 items-start gap-2 px-3 py-2 text-left text-xs text-ink-secondary hover:text-ink ${open ? 'flex-1' : 'w-full'}`}
                  >
                    <span
                      className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${BUBBLE_DOT[state]}`}
                      title={BUBBLE_LABEL[state]}
                      aria-label={BUBBLE_LABEL[state]}
                    />
                    {open ? <>
                      <span className="sr-only">{summary}</span>
                      {durationMs != null && <span data-agent-duration className="ml-auto min-w-0 truncate tabular-nums text-ink-muted">{formatDuration(durationMs)}</span>}
                    </> : (
                      <span className={`min-w-0 flex-1 line-clamp-2 break-words [overflow-wrap:anywhere] text-ink ${durationMs != null ? 'min-h-[2lh]' : ''}`}>
                        {/* 1행은 버튼, 2행은 시간만큼 각각 별도로 줄바꿈 폭을 줄인다. */}
                        <span aria-hidden="true" className="float-right h-[1lh]" style={{ width: actionSpace }} />
                        {durationMs != null && <span data-agent-duration className="float-right clear-right h-[1lh] max-w-full truncate pl-2 tabular-nums text-ink-muted">{formatDuration(durationMs)}</span>}
                        <span data-agent-summary className="select-text">{summary}</span>
                      </span>
                    )}
                  </button>
                  <div className={`flex shrink-0 items-start ${open ? '' : 'absolute right-0 top-0'}`}>
                  {open && question && <button type="button" onClick={() => scrollToQuestion(question.key)} className="my-1.5 rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">{t('agent.toQuestion')}</button>}
                  {/* 답변만 모아 복사한다 — 생각·도구 기록은 빼고 사람이 읽으라고 쓴 글만 */}
                  <CopyButton
                    text={answerText}
                    label={uiText("이 답변 복사")}
                  />
                  {/* 돌고 있는 턴만 중단할 수 있다 — 지난 턴에는 버튼이 없다 */}
                  {canStop && (
                    <button
                      type="button"
                      onClick={() => send({ type: 'cancel' })}
                      className="m-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
                      aria-label={uiText("중단")}
                      title={uiText("중단")}
                    >
                      <span className="h-2.5 w-2.5 rounded-[1px] bg-current" />
                    </button>
                  )}
                  </div>
                </div>
                {open && (
                  <div className="space-y-2 px-3 py-2">
                    {item.children.map((child) => {
                      if (child.kind === 'agent')
                        // 답변은 마크다운이다 — 목록·굵기·코드블럭을 글자 그대로 두지 않고 그린다
                        // (prose = @tailwindcss/typography, 다크는 index.css의 .dark 변형을 그대로 탄다)
                        return (
                          <div
                            key={child.key}
                            className="select-text mew-agent-markdown prose prose-sm max-w-none break-words [overflow-wrap:anywhere] text-ink dark:prose-invert prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:[overflow-wrap:anywhere] prose-pre:bg-surface-deep prose-code:text-ink-secondary"
                            onClick={(event) => handleMarkdownClick(event, onOpenFile)}
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(child.text) }}
                          />
                        )
                      if (child.kind === 'thought')
                        return <div key={child.key} className="select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs text-ink-muted italic">{child.text}</div>
                      if (child.kind === 'tool_group') {
                        const tOpen = expanded.has(child.key)
                        const failed = child.tools.filter((t) => t.status === 'failed').length
                        const running = child.tools.some((t) => t.status === 'in_progress' || t.status === 'pending')
                        const tSummary = uiText("{p0} · {p1}개 작업", { p0: running ? uiText("작업 중") : failed ? uiText("{p0}개 실패", { p0: failed }) : uiText("완료"), p1: child.tools.length })
                        const gState: BubbleState = failed ? 'failed' : running ? 'running' : 'done'
                        return (
                          <div key={child.key} className="rounded border border-edge bg-surface-deep px-2 py-1">
                            <button type="button" aria-expanded={tOpen} onClick={() => toggle(child.key)} className="flex w-full items-center gap-2 text-xs text-ink-secondary hover:text-ink">
                              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BUBBLE_DOT[gState]}`} />
                              <span>{tSummary}</span>
                            </button>
                            {tOpen && (
                              <div className="mt-1 space-y-0.5 border-t border-edge pt-1">
                                {child.tools.map((t) => (
                                  <div key={t.id} className="flex items-center gap-2 text-xs text-ink-secondary">
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BUBBLE_DOT[toolState(t.status)]}`} />
                                    <span className="select-text min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{t.title}</span>
                                    <span className="shrink-0 text-ink-muted">{STATUS_LABEL[t.status] ?? t.status}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      }
                      if (child.kind === 'permission')
                        return (
                          <div key={child.key} className="rounded border border-edge-bright bg-surface-deep px-2 py-1.5">
                            <div className="select-text mb-1.5 break-words [overflow-wrap:anywhere] text-xs text-ink-secondary">{child.title}</div>
                            {child.answered ? (
                              <div className="text-xs text-ink-muted">{uiText("응답함")}</div>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {child.options.map((option) => (
                                  <button
                                    key={option.optionId}
                                    type="button"
                                    onClick={() => send({ type: 'permission', id: child.id, optionId: option.optionId })}
                                    className={`rounded px-2 py-1 text-xs ${option.kind.startsWith('allow') ? 'bg-accent text-ink' : 'bg-surface-raised text-ink-secondary'} hover:bg-surface-hover`}
                                  >
                                    {option.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      return <AgentErrorButton key={child.key} text={child.text} onOpen={setErrorDetail} />
                    })}
                  </div>
                )}
              </div>
            )
          }
          return (
            <AgentErrorButton key={item.key} text={item.text} onOpen={setErrorDetail} block />
          )
        })}
        {/* 올려 읽는 동안 밑에서 대화가 자랐다는 표시 — 누르면 바닥으로 간다(바닥에 닿으면 스스로 사라진다).
            찾기 바(에디터)와 같은 수법: 스크롤 컨테이너에 sticky로 붙는 높이 0짜리 앵커라 본문을 밀지 않는다.
            marginTop은 인라인으로 지운다 — 부모의 space-y-3가 이 앵커에도 간격을 넣기 때문 */}
        {unread && (
          <div className="sticky bottom-0 z-10 h-0" style={{ marginTop: 0 }}>
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-surface-inverse px-3 py-1 text-xs text-ink-inverse shadow-lg"
            >
              {uiText("새 메시지 ")}<CaretGlyph dir="down" />
            </button>
          </div>
        )}
      </div>

      {conversationLoading && <div data-agent-loading className="absolute inset-0 overflow-hidden bg-surface-deep">
        <AgentLoadingBubbles label={t(!connected ? 'agent.connecting' : 'common.loading')} active={visible} />
      </div>}
      </div>

      {errorDetail && <AgentErrorDialog title={errorDetail.title} detail={errorDetail.detail} onClose={() => setErrorDetail(null)} />}
      {cli.error && <div role="alert" className="px-3 py-2 text-xs text-danger-strong">{cli.error}</div>}
      {commandPopup && <AgentCommandPopup key={commandPopup.id} command={commandPopup} onClose={() => setCommandPopupId(null)} onCancel={() => send({ type: 'cancel' })} onChanged={() => { void cli.refresh().catch(() => {}) }} />}

      {(queued.length > 0 || scheduled.length > 0) && (
        <div data-agent-queue className="relative z-10 max-h-[109px] shrink-0 space-y-1 overflow-y-auto overscroll-contain border-t border-edge bg-surface px-3 py-1.5 text-xs">
          {queued.map((text, index) => {
            const kind = queueMeta?.queuedKinds?.[index] ?? (text === '/clear' ? 'clear' : 'prompt')
            const isClearBoundary = kind === 'clear'
            const isCliCommand = kind === 'cli'
            const drag = queueDrag.drag
            const lifted = drag !== null && drag.slot === index
            const editing = editingQueued?.index === index ? editingQueued : null
            const expanded = expandedQueued?.index === index && expandedQueued.text === text
            const queuedFiles = queueMeta?.queuedAttachments?.[index] ?? []
            const queuedSettings = editing?.settings ?? queueMeta?.queuedSettings?.[index]
            return (
              <div
                key={`${index}-${text}`}
                ref={queueDrag.registerCell(index)}
                className="relative"
                data-queue-slot={index}
              >
                {lifted && <div
                  data-queue-drop-placeholder
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-30 rounded border border-dashed border-accent transition-transform duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                  style={{ transform: `translateY(${queueDrag.getReorderOffset(index)}px)` }}
                />}
                <div
                  data-queue-row={index}
                  data-queue-dragging={lifted ? '' : undefined}
                  style={{ transform: lifted ? `translate(${drag.dx}px, ${drag.dy}px)` : `translateY(${queueDrag.getReorderOffset(index)}px)` }}
                  className={`flex items-center gap-2 select-none ${editing ? 'rounded bg-surface-raised' : ''} ${lifted
                    ? 'relative z-20 rounded bg-surface-raised shadow-md pointer-events-none'
                    : drag ? 'relative z-10 transition-transform duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none' : ''}`}
                >
                  <button
                    type="button"
                    {...queueDrag.getTileProps(index)}
                    disabled={!connected || !meta || queued.length < 2 || editingQueued !== null}
                    onClick={() => { queueDrag.consumeClick() }}
                    onKeyDown={(event) => {
                      const target = event.key === 'ArrowUp' ? index - 1 : event.key === 'ArrowDown' ? index + 1 : null
                      if (target === null) return
                      event.preventDefault()
                      if (target >= 0 && target < queued.length) send({ type: 'move_queued', from: index, to: target })
                    }}
                    className="flex h-6 w-5 shrink-0 touch-none items-center justify-center rounded text-ink-muted hover:bg-surface-raised hover:text-ink enabled:cursor-grab active:cursor-grabbing disabled:opacity-40"
                    aria-label={uiText("드래그해서 순서 변경")}
                    title={uiText("드래그해서 순서 변경")}
                  >
                    <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
                      <circle cx="4" cy="3" r="1" /><circle cx="8" cy="3" r="1" />
                      <circle cx="4" cy="7" r="1" /><circle cx="8" cy="7" r="1" />
                      <circle cx="4" cy="11" r="1" /><circle cx="8" cy="11" r="1" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedQueued(expanded ? null : { index, text })
                    }}
                    aria-expanded={expanded}
                    title={isClearBoundary ? uiText("새 대화 시작 지점") : isCliCommand ? uiText("대기 중인 CLI 명령") : expanded ? uiText("접기") : uiText("펼치기")}
                    className={`flex min-w-0 flex-1 gap-1 text-left text-ink-secondary disabled:cursor-default ${expanded ? 'flex-col items-stretch' : 'items-center'} ${isCliCommand ? 'font-mono' : ''}`}
                  >
                    <span className={expanded ? 'min-w-0 whitespace-pre-wrap break-words text-left leading-4 select-text' : 'min-w-0 truncate'}>{isCliCommand ? `$ ${text}` : text}</span>
                    {expanded && !isClearBoundary && !isCliCommand && <span
                      data-queue-settings
                      className="text-[11px] leading-4 text-ink-muted break-words"
                      aria-label={uiText("실행 설정: {p0} · {p1} · {p2}", { p0: queuedSettings?.model ?? '—', p1: queuedSettings?.thinking ?? '—', p2: queuedSettings?.permission ?? '—' })}
                    >
                      {queuedSettings?.model ?? '—'} · {queuedSettings?.thinking ?? '—'} · {queuedSettings?.permission ?? '—'}
                    </span>}
                    {queuedFiles.length > 0 && <span data-queue-attachments className={expanded ? 'flex flex-wrap gap-1' : 'flex max-w-1/2 shrink-0 gap-1 overflow-hidden'}>
                      {queuedFiles.map(file => <span key={`${file.project}:${file.path}`} title={file.path.split('/').pop()}
                        className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-md bg-surface-raised p-1 text-ink-secondary">
                        <PaperclipGlyph /><span className="truncate">{expanded ? file.path.split('/').pop() : attachmentExtension(file.path)}</span>
                      </span>)}
                    </span>}
                  </button>
                  {!editing && !isClearBoundary && !isCliCommand && <button
                    type="button"
                    onPointerDown={keepFocusOnPress}
                    onClick={() => startQueuedEdit(index, text)}
                    disabled={!connected || !meta || editingQueued !== null}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-raised hover:text-ink disabled:opacity-40"
                    aria-label={uiText("편집")}
                    title={uiText("편집")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m16 3 5 5-12 12-6 1 1-6L16 3Z" /><path d="m14 5 5 5" />
                    </svg>
                  </button>}
                  {editing ? <button
                    type="button"
                    onPointerDown={keepFocusOnPress}
                    onClick={() => cancelQueuedEdit(editing)}
                    className="h-6 shrink-0 rounded px-2 text-ink-secondary hover:bg-surface-hover hover:text-ink"
                  >
                    {uiText("취소")}
                  </button> : <button
                    type="button"
                    onClick={() => {
                      send({ type: 'unqueue', index })
                    }}
                    disabled={!connected || !meta || editingQueued !== null}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-raised hover:text-ink disabled:opacity-40"
                    aria-label={uiText("대기 메시지 취소")}
                  >
                    <XGlyph small />
                  </button>}
                </div>
              </div>
            )
          })}
          {scheduled.length > 0 && (
            <div className={queued.length > 0 ? 'border-t border-edge pt-1.5' : ''} aria-label={uiText("예약된 메시지")}>
              {scheduled.map((job) => {
                const editing = editingScheduled?.id === job.id ? editingScheduled : null
                return <div key={job.id} className="flex items-center gap-2 py-0.5">
                  {editing ? (
                    <>
                      <ResizableQueueTextarea
                        label={uiText("예약 메시지 수정칸")}
                        value={editing.text}
                        onChange={(text) => setEditingScheduled({ ...editing, text })}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setEditingScheduled(null)
                            return
                          }
                          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                            event.preventDefault()
                            commitScheduledEdit(editing)
                          }
                        }}
                      />
                      <div className="flex shrink-0 flex-col gap-1">
                        <button type="button" onPointerDown={keepFocusOnPress} onClick={() => commitScheduledEdit(editing)} disabled={!editing.text.trim()} className="rounded bg-accent px-2 py-1 text-xs font-medium text-accent-ink hover:bg-accent-strong disabled:opacity-40">{uiText("완료")}</button>
                        <button type="button" onPointerDown={keepFocusOnPress} onClick={() => setEditingScheduled(null)} className="rounded border border-edge-strong px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink">{uiText("취소")}</button>
                      </div>
                    </>
                  ) : <>
                    <button
                      type="button"
                      onClick={() => setEditingScheduled({ id: job.id, text: job.text, original: job.text })}
                      disabled={editingScheduled !== null}
                      title={uiText("눌러서 수정")}
                      className="min-w-0 flex-1 truncate text-left text-ink-secondary disabled:cursor-default"
                    >{job.text}</button>
                    <button
                      type="button"
                      onClick={() => { setRescheduling(job); setScheduleOpen(true) }}
                      className="shrink-0 text-ink-muted hover:text-ink hover:underline"
                      aria-label={uiText("예약 시간 수정")}
                      title={uiText("예약 시간 수정")}
                    ><time dateTime={job.at}>{formatTime(job.at)}</time></button>
                  </>}
                  {!editing && <button
                    type="button"
                    onClick={() => { void cancelScheduled(job.id) }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-raised hover:text-ink"
                    aria-label={uiText("예약 메시지 취소")}
                    title={uiText("예약 메시지 취소")}
                  >
                    <XGlyph small />
                  </button>}
                </div>
              })}
            </div>
          )}
        </div>
      )}

        </>
      )}
      </div>
      </div>

      {!auth && (<>
      {scheduleOpen && (rescheduling || meta?.sessionId) && (
        <SchedulePromptInline
          onClose={() => { setScheduleOpen(false); setRescheduling(null) }}
          initialAt={rescheduling?.at}
          onConfirm={async (at) => {
            if (rescheduling) await updateScheduled(rescheduling, rescheduling.text, new Date(at).toISOString())
            else await schedule(at)
          }}
          disabled={rescheduling ? false : !draft.trim() && attachments.length === 0}
        />
      )}

      {/* 키보드를 쥐어도 되는 유일한 자리 — 전송 버튼을 눌러도 이어 쓰도록 포커스를 뺏지 않는다 */}
      <div
        ref={composerRef}
        className="relative flex shrink-0 flex-col gap-0.5 border-t border-edge p-2"
        style={{ height: `${visibleInputHeight}px`, marginBottom: `${viewportMetrics.bottomInset}px` }}
        data-agent-composer
        data-editing-queue={editingQueued ? '' : undefined}
        data-keep-keyboard
        onKeyDown={(event) => {
          if (editingQueued && event.key === 'Escape' && !event.defaultPrevented && !previewAttachment && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.stopPropagation()
            cancelQueuedEdit(editingQueued)
          }
        }}
        onKeyDownCapture={(event) => {
          if (event.target !== agentInputRef.current?.element || event.key !== 'Tab' || !event.ctrlKey
            || event.altKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          event.stopPropagation()
          if (!event.repeat) toggleCliMode()
        }}
      >
        {/* 채팅과 입력창 사이의 선 전체가 손잡이다. 투명한 hit area를 넓혀 선을 정확히 누르지 않아도 잡힌다. */}
        <div
          role="separator"
          aria-label={uiText("입력창 높이 조절")}
          aria-orientation="horizontal"
          aria-valuemin={minInputHeight}
          aria-valuemax={maxInputHeight}
          aria-valuenow={Math.round(visibleInputHeight)}
          tabIndex={0}
          onPointerDown={startInputResize}
          onKeyDown={resizeInputWithKeyboard}
          className="group absolute inset-x-0 -top-1.5 z-20 h-3 cursor-row-resize touch-none outline-none"
          title={uiText("끌어서 입력창 높이 조절")}
        >
          <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent group-hover:bg-accent group-focus-visible:bg-accent" />
        </div>
        <div className="flex min-h-0 flex-1 items-stretch gap-2">
        {/* 왼쪽 열은 실행 설정과 작성칸을 공유한다. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-visible">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <button type="button" onPointerDown={keepFocusOnPress} onClick={toggleCliMode}
              aria-label={uiText("CLI 명령 모드")} aria-pressed={composerCliMode}
              aria-keyshortcuts="Control+Tab"
              title={!allowTerminal ? uiText("터미널 권한이 필요합니다") : attaching || attachments.length ? uiText("첨부 파일을 제거한 뒤 CLI 모드를 켜세요") : composerCliMode ? uiText("CLI 명령 모드 켜짐 · 입력칸에서 Ctrl+Tab으로 전환") : uiText("CLI 명령 모드 · 입력칸에서 Ctrl+Tab으로 전환")}
              disabled={cliModeDisabled}
              className={`flex h-7 w-8 shrink-0 items-center justify-center rounded border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-secondary disabled:opacity-40 ${composerCliMode ? 'border-accent bg-accent text-ink-on-accent' : 'border-transparent text-ink-secondary hover:bg-surface-raised hover:text-ink'}`}>
              <TerminalIcon width={16} height={16} aria-hidden="true" />
            </button>
            <HeaderSelect className="flex-1" caretEnd value={composerModelId} options={modelOptions} onPick={(modelId) => editingQueued ? editQueueModel(modelId) : send({ type: 'set_model', modelId })} title={uiText("모델")} searchable disabled={!selectableModels || selectableModels.availableModels.length < 2} />
            <HeaderSelect value={composerThinkingId} options={composerThinkingOptions} onPick={(value) => {
              if (editingQueued) setEditingQueued(current => current ? { ...current, settings: { ...current.settings, thinkingId: value, thinking: composerThinkingOptions.find(option => option.id === value)?.label ?? value, ...(runtime === 'codex' ? { modelId: `${composerModelId}[${value}]` } : {}) } } : current)
              else if (thinking) send({ type: 'set_thinking', configId: thinking.configId, value })
            }} title={uiText("사고")} disabled={!thinking || composerThinkingOptions.length < 2} />
            <HeaderSelect value={composerModeId} options={modeOptions} onPick={(modeId) => {
              if (editingQueued) setEditingQueued(current => current ? { ...current, settings: { ...current.settings, modeId, permission: modeOptions.find(option => option.id === modeId)?.label ?? modeId } } : current)
              else send({ type: 'set_mode', modeId })
            }} title={uiText("권한")} disabled={!modes || modes.availableModes.length < 2} />
          </div>
        </div>
          <AgentAttachmentList attachments={composerAttachments} attaching={composerAttaching} onPreview={setPreviewAttachment}
            onRemove={attachment => {
              if (editingQueued) setEditingQueued(current => current ? { ...current, attachments: current.attachments.filter(item => item !== attachment) } : current)
              else setAttachments(current => current.filter(item => item.relPath !== attachment.relPath))
              setPreviewAttachment(current => current?.relPath === attachment.relPath ? null : current)
            }} />
          <MentionTextarea
            imageCapable
            value={composerDraft}
            onChange={(next) => {
              if (editingQueued) {
                setEditingQueued(current => current ? { ...current, text: next } : current)
                return
              }
              historyIndexRef.current = null
              historyDraftRef.current = ''
              if (!cliModeDisabled && next.startsWith('! ') && !draft.startsWith('! ')) {
                const caret = agentInputRef.current?.selectionStart ?? 2
                // CodeMirror may report document and selection updates before React renders.
                // Set the target mode so duplicate notifications cannot toggle it back.
                setCliMode(!cliMode)
                setScheduleOpen(false)
                setDraft(next.slice(2))
                requestAnimationFrame(() => agentInputRef.current?.setSelectionRange(Math.max(0, caret - 2), Math.max(0, caret - 2)))
                return
              }
              setDraft(next)
            }}
            options={composerCliMode ? [] : fileMentionOptions}
            onTriggerChange={composerCliMode ? undefined : setMentionTrigger}
            maxResults={Infinity}
            triggers={composerCliMode ? [] : mentionTriggers}
            onSubmit={submit}
            rows={2}
            placeholder={t('common.textInput')}
            className={`block min-h-0 w-full flex-1 resize-none rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted ${composerCliMode ? 'font-mono ring-1 ring-inset ring-accent/40' : ''}`}
            style={{ height: '100%' }}
            submitHint={editingQueued ? uiText("대기 메시지 수정칸") : composerCliMode ? uiText("Ctrl+Enter로 명령 실행") : uiText("Ctrl+Enter로 전송")}
            submitShortcut="mod-enter"
            onFilesDropped={composerCliMode ? undefined : (files) => { void attachFiles(files, editingQueued ? 'queue' : 'composer') }}
            onImagesPasted={composerCliMode ? undefined : (files) => { void attachFiles(files, editingQueued ? 'queue' : 'composer') }}
            inputRef={agentInputRef}
            onHistoryNavigate={editingQueued ? undefined : navigateAgentHistory}
            onOptionSelect={(option) => {
              if (option.id.startsWith('project:')) onProjectMention(tabId, option.label)
            }}
          />
        </div>
        <div ref={composerActionsRef} className="flex shrink-0 flex-col justify-between">
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              void attachFiles(files, editingQueued ? 'queue' : 'composer')
            }}
          />
          <div className="flex h-7 shrink-0 items-center justify-center">
            <div className="flex h-5 w-8 items-center justify-center bg-transparent">
              <button type="button" onClick={saveCurrentDefault} disabled={!!editingQueued || !currentDefault || savingDefault} className={`flex h-full w-full items-center justify-center rounded hover:bg-surface-raised hover:text-ink disabled:opacity-40 ${defaultIsSaved ? 'text-accent' : 'text-ink-secondary'}`} aria-label={uiText("현재 모델·추론 정도·권한을 기본값으로 저장")} title={savingDefault ? uiText("기본값 저장 중…") : defaultIsSaved ? uiText("{p0}의 저장된 기본값입니다", { p0: currentRuntime.label }) : uiText("현재 모델·추론 정도·권한을 {p0} 기본값으로 저장", { p0: currentRuntime.label })}><SaveGlyph /></button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <button type="button" onClick={() => attachmentInputRef.current?.click()} disabled={composerCliMode || composerAttaching} className="flex h-6 w-8 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised disabled:opacity-40" aria-label={uiText("파일 첨부")} title={uiText("파일 첨부")}><PaperclipGlyph /></button>
            {!editingQueued && (
            <button
              type="button"
              onClick={() => setScheduleOpen(true)}
              disabled={composerCliMode || !meta?.sessionId}
              className="flex h-6 w-8 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised disabled:opacity-40"
              aria-label={uiText("예약 메시지")}
              title={uiText("예약 메시지")}
            >
              <ClockGlyph />
            </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!connected || !!loadingSession || composerAttaching || (composerCliMode && (cli.submitting || !meta?.sessionId || !allowTerminal)) || (!composerDraft.trim() && composerAttachments.length === 0)}
              className="flex h-8 w-8 items-center justify-center rounded bg-accent text-ink-on-accent disabled:opacity-40"
              aria-label={editingQueued ? uiText("저장") : composerCliMode ? uiText("명령 실행") : uiText("전송")}
              title={editingQueued ? uiText("저장") : composerCliMode ? uiText("명령 실행 (Ctrl+Enter)") : uiText("전송 (Ctrl+Enter)")}
            >
              {editingQueued ? <SaveGlyph /> : <SendGlyph />}
            </button>
          </div>
        </div>
        </div>
      </div>
      {previewAttachment && (
        <AgentImagePreviewDialog
          src={rawUrl(previewAttachment.relPath, previewAttachment.project)}
          name={previewAttachment.extension}
          onClose={() => setPreviewAttachment(null)}
        />
      )}
        </>
      )}

      {authTerminal && authTerminalOpen && (
        <SessionTerminalPopup
          title={authTerminal.label}
          subtitle={uiText("{p0} 로그인", { p0: currentRuntime.label })}
          session={authTerminal.session}
          running
          statusNote={authTerminal.state === 'running'
            ? uiText("로그인 중…")
            : authTerminal.state === 'failed'
              ? uiText("로그인하지 못했습니다. 닫은 뒤 다시 시도하세요.")
              : authTerminal.state === 'interrupted'
                ? uiText("로그인이 중단됐습니다. 닫은 뒤 다시 시도하세요.")
                : uiText("연결 중…")}
          statusTone={authTerminal.state === 'failed' || authTerminal.state === 'interrupted' ? 'danger' : 'muted'}
          browserLoginUrl={authTerminal.verificationUrl}
          onOpenBrowserLogin={() => {
            if (!authTerminal.verificationUrl) return
            void openAgentAuthServerBrowser(runtime, tabId, authTerminal.methodId).then((page) => {
              const next = { methodId: authTerminal.methodId, ...page }
              authBrowserRef.current = next; setAuthBrowser(next); setAuthTerminalOpen(false)
            }).catch((error: unknown) => setErrorDetail({ title: uiText("로그인 페이지를 열지 못했습니다"), detail: String(error) }))
          }}
          onRun={() => runAgentAuthTerminal(runtime, tabId, cwd, authTerminal.methodId)}
          onClose={() => setAuthTerminalOpen(false)}
          onChanged={() => {}}
        />
      )}
    </div>
  )
}

function AgentAuthServerBrowser({
  runtime,
  page,
  reopen,
  verificationCode,
  onReady,
  onPopup,
  onClose,
}: {
  runtime: string
  verificationCode: string | null
  onPopup: (id: string) => void
  onReady: () => void
  page: { methodId: string | null; url: string; streamUrl: string }
  reopen: () => Promise<string>
  onClose: () => void
}) {
  useUiLocale()
  let host = uiText("인증 서버")
  try { host = new URL(page.url).hostname } catch { /* 서버가 이미 검증한 URL */ }
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-surface-deep" aria-label={uiText("{p0} 로그인 브라우저", { p0: runtime })}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge bg-surface px-2">
        <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-secondary">{host}</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
          aria-label={uiText("로그인 브라우저 닫기")}
          title={uiText("로그인 화면으로 돌아가기")}
        >
          ×
        </button>
      </div>
      {verificationCode && <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-surface px-3 py-2 text-sm text-ink">
        <span className="shrink-0">{uiText("승인 코드:")}</span>
        <code className="min-w-0 select-all break-all font-mono">{verificationCode}</code>
        <CopyButton key={verificationCode} text={verificationCode} label={uiText("승인 코드 복사")} />
      </div>}
      <ServerDomBrowserTabs key={page.streamUrl} streamUrl={page.streamUrl} reopen={reopen} onPopup={onPopup} onReady={onReady} />
    </section>
  )
}

function AgentAuthPanel({
  runtime,
  state,
  urlRequest,
  onAuthenticate,
  onOpenUrl,
  onCancelUrl,
  onBackToPicker,
  browserLoginUrl,
  browserLoginCode,
  browserLoginInput,
  browserLoginPreparing,
  browserLoginError,
  onOpenBrowserLogin,
  onSubmitBrowserLoginInput,
  onOpenTerminal,
  onStartBrowserLogin,
}: {
  runtime: string
  state: AgentAuthState
  urlRequest: AgentAuthUrl | null
  onAuthenticate: (methodId: string, secret?: string) => void
  onOpenUrl: (request: AgentAuthUrl) => void
  onCancelUrl: (id: string) => void
  onBackToPicker: () => void
  browserLoginUrl: string | null
  browserLoginCode: string | null
  browserLoginInput: 'authorization-code' | null
  browserLoginPreparing: boolean
  browserLoginError: string | null
  onOpenBrowserLogin: () => void
  onSubmitBrowserLoginInput: (input: string) => Promise<void>
  onOpenTerminal: (methodId: string) => void
  onStartBrowserLogin: (methodId: string) => void
}) {
  useUiLocale()
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({})
  const [browserInputValue, setBrowserInputValue] = useState('')
  const [browserInputSubmitting, setBrowserInputSubmitting] = useState(false)
  const [browserInputError, setBrowserInputError] = useState<string | null>(null)
  const browserInputId = useId()
  const actionClass = 'min-h-10 shrink-0 rounded-md bg-accent px-3 py-2 text-sm text-ink-on-accent hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40'
  const inputClass = 'min-h-10 min-w-0 flex-1 rounded-md border border-edge-strong bg-surface-deep px-3 py-2 text-sm text-ink placeholder:text-ink-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
  const backToPicker = () => {
    // URL 인증 요청을 열린 채로 두면 ACP 쪽이 사용자 응답을 계속 기다린다.
    if (urlRequest) onCancelUrl(urlRequest.id)
    onBackToPicker()
  }

  if (urlRequest) {
    let host = urlRequest.url
    try { host = new URL(urlRequest.url).host } catch { /* 서버가 이미 검사했다 */ }
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <button type="button" onClick={backToPicker} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label={uiText("에이전트 목록으로 돌아가기")} title={uiText("에이전트 목록으로 돌아가기")}><BackChevron /></button>
        <div className="mx-auto my-auto w-full max-w-sm py-6">
          <h2 className="text-base font-semibold text-ink">{runtime} {uiText(" 로그인")}</h2>
          <p className="mt-2 break-all text-sm text-ink-secondary">{host}</p>
          {urlRequest.message && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-ink-secondary">{urlRequest.message}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onCancelUrl(urlRequest.id)}
              className="min-h-10 rounded-md border border-edge-strong px-3 py-2 text-sm text-ink-secondary hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {uiText("취소")}</button>
            <button
              type="button"
              onClick={() => onOpenUrl(urlRequest)}
              className={actionClass}
            >
              {uiText("로그인 페이지 열기")}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <button type="button" onClick={backToPicker} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label={uiText("에이전트 목록으로 돌아가기")} title={uiText("에이전트 목록으로 돌아가기")}><BackChevron /></button>
      <div className="mx-auto my-auto w-full max-w-sm py-6">
        <h2 className="mb-5 text-base font-semibold text-ink">{runtime} {uiText(" 로그인")}</h2>
        <div className="space-y-3">
          {state.methods.map((method) => (
            <div key={method.id}>
              {method.kind !== 'api-key' ? (
                <>
                  <button
                    type="button"
                    onClick={() => method.kind === 'agent' ? onAuthenticate(method.id) : method.surface === 'browser' ? onStartBrowserLogin(method.id) : onOpenTerminal(method.id)}
                    disabled={state.authenticating || browserLoginPreparing}
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-edge-strong bg-surface px-3 py-2.5 text-left text-sm text-ink hover:border-edge-bright hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                  >
                    <span className="min-w-0 break-words">{method.name}</span>
                    <span className="shrink-0 rotate-180 text-ink-secondary"><BackChevron /></span>
                  </button>
                  {method.kind === 'terminal' && method.surface !== 'browser' && method.description && <p className="mt-2 text-xs text-ink-secondary">{method.description}</p>}
                </>
              ) : (
                <form
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const value = apiKeys[method.id]?.trim()
                    if (!value) return
                    onAuthenticate(method.id, value)
                    setApiKeys((current) => ({ ...current, [method.id]: '' }))
                  }}
                >
                  <label htmlFor={`${browserInputId}-${method.id}`} className="block text-sm text-ink">{method.name}</label>
                  <div className="flex gap-2">
                    <input
                      id={`${browserInputId}-${method.id}`}
                      type="password"
                      value={apiKeys[method.id] ?? ''}
                      onChange={(event) => setApiKeys((current) => ({ ...current, [method.id]: event.target.value }))}
                      autoComplete="off"
                      placeholder={uiText("API 키")}
                      className={inputClass}
                    />
                    <button
                      type="submit"
                      disabled={state.authenticating || !apiKeys[method.id]?.trim()}
                      className={actionClass}
                    >
                      {uiText("연결")}</button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
        {browserLoginPreparing && (
          <p className="mt-4 text-sm text-ink-secondary" role="status">{uiText("로그인 준비 중…")}</p>
        )}
        {browserLoginUrl && (
          <div className="mt-5 space-y-3 border-t border-edge pt-4">
            {browserLoginCode && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                <span className="text-ink-secondary">{uiText("승인 코드")}</span>
                <code className="min-w-0 select-all break-all font-mono font-semibold">{browserLoginCode}</code>
                <CopyButton key={browserLoginCode} text={browserLoginCode} label={uiText("승인 코드 복사")} />
              </div>
            )}
            <button type="button" onClick={onOpenBrowserLogin} className={actionClass + ' w-full'}>{uiText("로그인 계속하기")}</button>
          </div>
        )}
        {browserLoginUrl && browserLoginInput === 'authorization-code' && (
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault()
              const input = browserInputValue.trim()
              if (!input || browserInputSubmitting) return
              setBrowserInputSubmitting(true)
              setBrowserInputError(null)
              void onSubmitBrowserLoginInput(input)
                .then(() => setBrowserInputValue(''))
                .catch((err: unknown) => setBrowserInputError(err instanceof Error ? err.message : String(err)))
                .finally(() => setBrowserInputSubmitting(false))
            }}
          >
            <label className="text-xs text-ink-secondary" htmlFor={browserInputId}>{uiText("브라우저에 표시된 인증 코드")}</label>
            <div className="mt-1.5 flex gap-2">
              <input
                id={browserInputId}
                type="password"
                value={browserInputValue}
                onChange={(event) => setBrowserInputValue(event.target.value)}
                autoComplete="off"
                placeholder={uiText("인증 코드 붙여넣기")}
                className={inputClass}
              />
              <button
                type="submit"
                disabled={!browserInputValue.trim() || browserInputSubmitting}
                className={actionClass}
              >
                {browserInputSubmitting ? uiText("전송 중…") : uiText("코드 전송")}
              </button>
            </div>
            {browserInputError && <p className="mt-2 text-sm text-danger-ink" role="alert">{browserInputError}</p>}
          </form>
        )}
        {browserLoginError && (
          <p className="mt-4 break-words text-sm text-danger-ink" role="alert">{browserLoginError}</p>
        )}
        {state.authenticating && !browserLoginPreparing && <p className="mt-4 text-sm text-ink-secondary" role="status">{uiText("로그인 확인 중…")}</p>}
        {state.error && <p className="mt-4 whitespace-pre-wrap break-words text-sm text-danger-ink" role="alert">{state.error}</p>}
      </div>
    </div>
  )
}

function BackChevron() {
  useUiLocale()
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
}

/** 접기·펼치기와 드롭다운 화살표를 하나로 — dir만 바꿔 돌려 쓴다 */
function CaretGlyph({ dir }: { dir: 'right' | 'down' | 'up' }) {
  useUiLocale()
  const rotate = dir === 'down' ? 'rotate-90' : dir === 'up' ? '-rotate-90' : ''
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${rotate}`}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  )
}

function errorTitle(text: string): string {
  const first = text.split(/\r?\n/, 1)[0]?.trim()
  return first || 'Internal Error'
}

function AgentErrorButton({
  text,
  onOpen,
  block,
}: {
  text: string
  onOpen: (detail: { title: string; detail: string }) => void
  block?: boolean
}) {
  useUiLocale()
  const title = errorTitle(text)
  return (
    <button
      type="button"
      onClick={() => { if (!hasSelection()) onOpen({ title, detail: text }) }}
      className={`${block ? 'rounded-lg bg-surface px-3 py-2' : 'rounded border border-danger/30 bg-surface-deep px-2 py-1'} break-words [overflow-wrap:anywhere] text-left text-xs text-danger hover:bg-surface-raised hover:underline`}
      title={uiText("오류 상세 보기")}
    >
      <span className="select-text">{title}</span>
    </button>
  )
}

function AgentImagePreviewDialog({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useUiLocale()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={uiText("{p0} 사진 미리보기", { p0: name })}
        className="relative flex max-h-full max-w-full items-center justify-center"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <img src={src} alt={name} className="max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] rounded object-contain shadow-2xl" />
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/80"
          aria-label={uiText("사진 미리보기 닫기")}
          title={uiText("닫기")}
        >
          <XGlyph />
        </button>
      </div>
    </div>
  )
}

function AgentErrorDialog({ title, detail, onClose }: { title: string; detail: string; onClose: () => void }) {
  useUiLocale()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={uiText("에이전트 오류 상세")}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{title}</div>
          <CopyButton text={detail} label={uiText("오류 상세 복사")} />
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label={uiText("닫기")}
          >
            <XGlyph />
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 text-xs text-ink-secondary">{detail}</pre>
      </div>
    </div>
  )
}

function localDateTimeValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function SchedulePromptInline({
  onClose,
  onConfirm,
  disabled,
  initialAt,
}: {
  onClose: () => void
  onConfirm: (at: string) => Promise<void>
  disabled: boolean
  initialAt?: string
}) {
  useUiLocale()
  const [now, setNow] = useState(Date.now())
  const [at, setAt] = useState(() => {
    const minimum = nextLocalMinuteValue(Date.now())
    const initial = initialAt ? localDateTimeValue(new Date(initialAt)) : localDateTimeValue(new Date(Date.now() + 60 * 60_000))
    return initial < minimum ? minimum : initial
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const minimumAt = nextLocalMinuteValue(now)
  useEffect(() => {
    setAt((current) => current < minimumAt ? minimumAt : current)
  }, [minimumAt])
  const remaining = formatScheduleRemaining(new Date(at).getTime() - now)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (new Date(at).getTime() <= Date.now()) return setError(uiText("미래의 날짜와 시간을 고르세요"))
    setSaving(true); setError(null)
    try {
      await onConfirm(at)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form aria-label={uiText("예약 전송")} onSubmit={submit} className="relative flex shrink-0 flex-col items-center border-t border-edge bg-surface px-3 py-1.5">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-1.5 flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-surface-raised hover:text-ink"
        aria-label={uiText("예약 전송 닫기")}
        title={uiText("닫기")}
      >
        <XGlyph small />
      </button>
      <div className="w-full max-w-72">
        <ScrollDateTimePicker value={at} onChange={setAt} min={minimumAt} />
      </div>
      <div className="mt-1 flex items-center justify-center gap-2">
        {error
          ? <p className="select-text text-[11px] text-danger">{error}</p>
          : <p className="text-xs text-ink-muted" aria-live="polite">{remaining}</p>}
        <button type="submit" disabled={saving || disabled} className="shrink-0 rounded bg-accent px-2 py-1 text-xs font-medium text-ink-on-accent disabled:opacity-50">{saving ? uiText("등록 중…") : uiText("예약")}</button>
      </div>
    </form>
  )
}

function formatScheduleRemaining(milliseconds: number) {
  if (milliseconds <= 0) return uiText("이미 지난 시간입니다")
  const minutes = Math.floor(milliseconds / 60_000)
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.floor((minutes % (24 * 60)) / 60)
  const restMinutes = minutes % 60
  const parts = [days && uiText("{p0}일", { p0: days }), hours && uiText("{p0}시간", { p0: hours }), restMinutes && uiText("{p0}분", { p0: restMinutes })].filter(Boolean)
  return uiText("{p0} 후", { p0: parts.length ? parts.join(' ') : uiText("1분") })
}

/** 버블 텍스트를 통째로 클립보드에 넣는다 — 끌어 고르지 않고 한 번에 가져가는 길 */
function CopyButton({ text, label }: { text: string; label: string }) {
  useUiLocale()
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(false), 1200)
    return () => clearTimeout(timer)
  }, [done])
  if (!text.trim()) return null
  return (
    <button
      type="button"
      onClick={() => void copyText(text).then((ok) => ok && setDone(true))}
      className="m-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
      aria-label={label}
      title={label}
    >
      {done ? <CheckGlyph /> : <CopyGlyph />}
    </button>
  )
}

function CopyGlyph() {
  useUiLocale()
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="13" height="13" x="9" y="9" rx="2" />
      <path d="M5 15c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h8c1.1 0 2 .9 2 2" />
    </svg>
  )
}

function CheckGlyph() {
  useUiLocale()
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 12 5 5L20 6" />
    </svg>
  )
}

function PlusGlyph() {
  useUiLocale()
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function FolderGlyph() {
  useUiLocale()
  return (
    <svg className="shrink-0 text-ink-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
    </svg>
  )
}

function HomeGlyph() {
  useUiLocale()
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </svg>
  )
}

function ArrowGlyph() {
  useUiLocale()
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

/** 지난 대화 — 시계 반대 방향 화살표로 돌아볼 수 있음을 나타낸다. */
function HistoryGlyph() {
  useUiLocale()
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function ClearGlyph() {
  useUiLocale()
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

function InfoGlyph() {
  useUiLocale()
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  )
}

function SaveGlyph() {
  useUiLocale()
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h13l3 3v13H4z" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" />
    </svg>
  )
}

function XGlyph({ small }: { small?: boolean }) {
  useUiLocale()
  const s = small ? 12 : 14
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

function SendGlyph() {
  useUiLocale()
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5m-6 6 6-6 6 6" />
    </svg>
  )
}

function ClockGlyph() {
  useUiLocale()
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function PaperclipGlyph() {
  useUiLocale()
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m20.5 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.2-8.2a3.5 3.5 0 1 1 5 5l-8.2 8.2a2 2 0 1 1-2.8-2.8l7.5-7.5" /></svg>
}
