import { canAutoFocusInput } from '@mew/ui'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
// 프로젝트 탭의 ▶ 아이콘 버튼 = 명령어 버튼. 누르면 그 프로젝트의 <프로젝트>/.mew/cmd-button.json 에
// 정의된 명령들을 이름으로 나열한다. 각 줄엔 ▶(내부 tmux 세션에서 실행)과 터미널 아이콘(세션 팝업)이
// 있고, 줄을 꾹 누르거나 우클릭하면 수정·삭제가 뜬다. 맨 아래 +로 새 명령을 추가한다.
// **실행 중인 줄의 ▶는 ■(정지)가 된다** — 누르면 그 명령의 세션만 죽는다(파란 점도 함께 꺼진다).
// 실행 세션은 특수 이름(mewcmd-*)이라 터미널 탭 목록엔 뜨지 않는다.
//
// 목록은 프로젝트 탭마다 뜨므로 project를 반드시 인자로 받는다 — 활성 프로젝트가 아닌 탭의
// 메뉴도 열 수 있기 때문이다. 드롭다운은 프로젝트 탭 줄이 가로 스크롤 컨테이너라 그 안에
// absolute로 두면 잘린다 — 그래서 body로 포털해 fixed로 띄운다.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import { fetchCmdButtons, killTmuxSession, runCmdButton, saveCmdButtons, type CmdButtonState } from '../api/client'
import { SessionTerminalPopup } from './SessionTerminalPopup'

const LONG_PRESS_MS = 500
const MENU_WIDTH = 288 // w-72

/** 편집 중인 명령. index가 null이면 새로 추가하는 중 */
type Editing = { index: number | null; name: string; command: string; oneShot: boolean }

export function CommandButtonMenu({
  project,
  directory = '',
  title,
  open: controlledOpen,
  onOpenChange,
  inline = false,
  hideTrigger = false,
  alwaysOpen = false,
  triggerRef,
}: {
  project: string
  directory?: string
  title?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  inline?: boolean
  hideTrigger?: boolean
  /** 사이드바 명령 탭처럼 목록 자체가 화면일 때는 닫지 않고 계속 보인다. */
  alwaysOpen?: boolean
  /** 인라인 메뉴를 여는 외부 버튼도 바깥 클릭 판정에서는 메뉴 안으로 친다. */
  triggerRef?: RefObject<HTMLElement | null>
}) {
  useUiLocale()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = alwaysOpen || (controlledOpen ?? uncontrolledOpen)
  const setOpen = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    if (alwaysOpen) return
    const value = typeof next === 'function' ? next(open) : next
    if (controlledOpen === undefined) setUncontrolledOpen(value)
    onOpenChange?.(value)
  }, [alwaysOpen, controlledOpen, onOpenChange, open])
  const [buttons, setButtons] = useState<CmdButtonState[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 실행·종료 요청이 날아가 있는 동안의 명령 이름 — 그 줄의 버튼을 잠근다(button.running과 다르다)
  const [busyName, setBusyName] = useState<string | null>(null)
  const [popup, setPopup] = useState<CmdButtonState | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const closeMenu = useCallback(() => setOpen(false), [setOpen])
  // Esc·모바일 뒤로가기로 드롭다운을 닫는다. 세션 팝업·편집 창이 떠 있으면 그쪽이 스택 위라 먼저 닫힌다
  useOverlayDismiss(open && !inline && closeMenu)

  const refresh = useCallback(() => {
    fetchCmdButtons(project, directory)
      .then((res) => {
        setButtons(res.buttons)
        setError(null)
      })
      .catch((err) => {
        setButtons([])
        setError(err instanceof Error ? err.message : uiText("불러오기 실패"))
      })
  }, [project, directory])

  // 메뉴가 열려 있는 동안 목록·실행 상태를 불러오고 가볍게 폴링한다(실행 표시 갱신용).
  // 인라인 사이드바도 항상 열린 메뉴이므로 여기서 제외하면 첫 요청을 보내지 않아
  // "불러오는 중…"에 영구히 남는다.
  useEffect(() => {
    if (!open) return
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [open, refresh])

  // 버튼 위치에 맞춰 드롭다운을 놓는다 — 탭 줄이 스크롤되거나 창이 바뀌면 다시 잰다
  useEffect(() => {
    if (!open || inline) return
    function place() {
      const rect = btnRef.current?.getBoundingClientRect()
      if (!rect) return
      const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
      setAnchor({ top: rect.bottom + 4, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [inline, open])

  // 바깥을 누르면 드롭다운을 닫는다 (드롭다운이 포털이라 DOM 상 부모가 아니어서 둘 다 확인한다)
  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      const target = e.target as Node
      if (btnRef.current?.contains(target) || triggerRef?.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open, setOpen, triggerRef])

  async function run(button: CmdButtonState) {
    if (busyName) return
    setBusyName(button.name)
    try {
      await runCmdButton(project, button.name, directory)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("실행 실패"))
    } finally {
      setBusyName(null)
    }
  }

  /** 실행 중일 때 재생 버튼은 정지 버튼이 된다 — 이 명령 전용 세션(mewcmd-*)만 죽인다 */
  async function stop(button: CmdButtonState) {
    if (busyName) return
    setBusyName(button.name)
    try {
      await killTmuxSession(button.session)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("종료 실패"))
    } finally {
      setBusyName(null)
    }
  }

  /** 추가·수정·삭제 모두 목록 전체 저장 한 경로로 처리한다 */
  async function commit(next: { name: string; command: string; oneShot?: boolean }[]) {
    const res = await saveCmdButtons(project, next, directory)
    setButtons(res.buttons)
    setError(null)
  }

  const list = buttons ?? []

  const menu = (
    <div
      ref={menuRef}
      data-cmd-overlay={!inline || undefined}
      style={inline ? undefined : { top: anchor?.top, left: anchor?.left, width: MENU_WIDTH }}
      className={inline
        ? 'border-b border-edge bg-surface-deep py-1'
        : 'fixed z-[1050] max-h-[60vh] overflow-auto rounded-lg border border-edge-bright bg-surface-raised py-1 shadow-xl'}
    >
      {!inline && <div className="px-3 pb-1 pt-0.5 text-[11px] text-ink-muted">{directory || project}</div>}
      {error && <div className="select-text px-3 py-2 text-xs text-danger-strong">{error}</div>}
      {buttons === null ? (
        <div className="px-3 py-3 text-xs text-ink-muted">{uiText("불러오는 중…")}</div>
      ) : (
        list.map((b, i) => (
          <CmdRow key={`${b.name}-${i}`} button={b} busy={busyName === b.name} onRun={() => run(b)} onStop={() => stop(b)} onOpenSession={() => { setPopup(b); setOpen(false) }} onEdit={() => setEditing({ index: i, name: b.name, command: b.command, oneShot: b.oneShot })} />
        ))
      )}
      {buttons !== null && list.length === 0 && !error && <div className="px-3 py-2 text-xs text-ink-muted">{uiText("아직 명령이 없습니다.")}</div>}
      <button type="button" onClick={() => setEditing({ index: null, name: '', command: '', oneShot: false })} className="mt-1 flex w-full items-center gap-1.5 border-t border-edge px-3 py-2 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink">
        <span className="text-sm leading-none">＋</span> {uiText(" 명령 추가")}</button>
    </div>
  )

  return (
    <>
      {!hideTrigger && <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink ${
          open ? 'bg-surface-hover text-ink' : ''
        }`}
        title={title ?? uiText("{p0} 명령어 버튼", { p0: directory || project })}
        aria-label={uiText("{p0} 명령어 버튼", { p0: directory || project })}
        aria-expanded={open}
      >
        <PlayGlyph />
      </button>}

      {open && (inline ? menu : anchor && createPortal(menu, document.body))}

      {editing && (
        <CmdButtonEditor
          project={directory || project}
          editing={editing}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            const base = list.map((b) => ({ name: b.name, command: b.command, oneShot: b.oneShot }))
            const entry = { name: draft.name.trim(), command: draft.command.trim(), oneShot: draft.oneShot }
            await commit(draft.index === null ? [...base, entry] : base.map((b, i) => (i === draft.index ? entry : b)))
            setEditing(null)
          }}
          onDelete={
            editing.index === null
              ? undefined
              : async () => {
                  await commit(
                    list.filter((_, i) => i !== editing.index).map((b) => ({ name: b.name, command: b.command, oneShot: b.oneShot })),
                  )
                  setEditing(null)
                }
          }
        />
      )}

      {popup && (
        <SessionTerminalPopup
          title={popup.name}
          subtitle={popup.command}
          idleNote={popup.command}
          session={popup.session}
          running={popup.running}
          onRun={() => runCmdButton(project, popup.name, directory)}
          onClose={() => setPopup(null)}
          onChanged={refresh}
        />
      )}
    </>
  )
}

/** 한 줄 = 명령 하나. 이름을 꾹 누르거나(모바일) 우클릭하면(데스크톱) 수정 창이 뜬다 */
function CmdRow({
  button,
  busy,
  onRun,
  onStop,
  onOpenSession,
  onEdit,
}: {
  button: CmdButtonState
  busy: boolean
  onRun: () => void
  /** 실행 중일 때 재생 버튼이 하는 일 — 이 명령의 세션 종료 */
  onStop: () => void
  onOpenSession: () => void
  onEdit: () => void
}) {
  useUiLocale()
  const timerRef = useRef<number | null>(null)
  const longFiredRef = useRef(false)

  const cancelPress = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => cancelPress, [cancelPress])

  return (
    <div className="group flex items-center gap-1 px-1.5 py-0.5">
      <button
        type="button"
        onPointerDown={() => {
          longFiredRef.current = false
          cancelPress()
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null
            longFiredRef.current = true
            onEdit()
          }, LONG_PRESS_MS)
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onClick={() => {
          // 꾹 눌러 수정 창을 연 뒤 손을 떼면 click이 뒤따라 온다 — 그 한 번은 실행하지 않는다
          if (longFiredRef.current) {
            longFiredRef.current = false
            return
          }
          onRun()
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!longFiredRef.current) onEdit()
        }}
        disabled={busy}
        className="min-w-0 flex-1 select-none truncate px-1.5 py-1 text-left text-sm text-ink disabled:opacity-40"
        style={{ touchAction: 'manipulation' }}
        title={uiText("{p0}\n(꾹 누르거나 우클릭하면 수정)", { p0: button.command })}
      >
        {button.name}
      </button>
      {button.running && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" title={uiText("실행 세션 있음")} />}
      {/* 실행 중이면 같은 자리가 정지 버튼이 된다 — 누르면 이 명령의 세션이 죽는다 */}
      <button
        type="button"
        onClick={button.running ? onStop : onRun}
        disabled={busy}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover disabled:opacity-40 ${
          button.running ? 'hover:text-danger-strong' : 'hover:text-accent-strong'
        }`}
        title={button.running ? uiText("명령 중지") : uiText("실행")}
        aria-label={`${button.name} ${button.running ? uiText("정지") : uiText("실행")}`}
      >
        {button.running ? <StopGlyph /> : <PlayGlyph small />}
      </button>
      <button
        type="button"
        onClick={onOpenSession}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-hover hover:text-ink"
        title={uiText("터미널 세션 보기")}
        aria-label={uiText("{p0} 터미널 세션", { p0: button.name })}
      >
        <TerminalGlyph />
      </button>
    </div>
  )
}

/** 이름·명령어만 있는 단순 편집 창 — .mew/cmd-button.json 의 항목 하나에 해당한다 */
function CmdButtonEditor({
  project,
  editing,
  onSave,
  onCancel,
  onDelete,
}: {
  project: string
  editing: Editing
  onSave: (draft: Editing) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void>
}) {
  useUiLocale()
  const [draft, setDraft] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const canSave = draft.name.trim() !== '' && draft.command.trim() !== ''

  useEffect(() => {
    if (canAutoFocusInput()) nameRef.current?.focus()
  }, [])

  // Esc·모바일 뒤로가기로 이 창만 닫는다 — 스택 맨 위라 드롭다운은 그대로 남는다
  useOverlayDismiss(onCancel)

  async function withBusy(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("저장 실패"))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      data-cmd-overlay
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="w-full max-w-sm rounded-lg border border-edge-bright bg-surface-raised p-4 shadow-xl">
        <div className="mb-1 text-sm font-medium text-ink">{editing.index === null ? uiText("명령 추가") : uiText("명령 수정")}</div>
        <div className="mb-3 text-xs text-ink-secondary">
          {uiText("실행 폴더: ")}{project}
        </div>

        <label className="mb-1 block text-xs text-ink-secondary">{uiText("이름")}</label>
        <input
          ref={nameRef}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder={uiText("빌드")}
          className="mb-3 w-full rounded border border-edge-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
        />

        <label className="mb-1 block text-xs text-ink-secondary">{uiText("명령어")}</label>
        <textarea
          value={draft.command}
          onChange={(e) => setDraft({ ...draft, command: e.target.value })}
          rows={2}
          placeholder="npm run build"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="mb-3 w-full resize-none rounded border border-edge-strong bg-surface px-2 py-1.5 font-mono text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
        />

        <label className="mb-3 flex items-center gap-1.5 text-xs text-ink-secondary">
          <input
            type="checkbox"
            checked={draft.oneShot}
            onChange={(e) => setDraft({ ...draft, oneShot: e.target.checked })}
          />
          {uiText("완료 후 터미널 종료")}</label>

        {error && <div className="select-text mb-2 text-xs text-danger-strong">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => withBusy(onDelete)}
              className="mr-auto rounded border border-edge-strong px-3 py-1.5 text-sm text-danger-strong hover:bg-surface disabled:opacity-40"
            >
              {uiText("삭제")}</button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-edge-strong px-3 py-1.5 text-sm text-ink hover:bg-surface"
          >
            {uiText("취소")}</button>
          <button
            type="button"
            disabled={busy || !canSave}
            onClick={() => withBusy(() => onSave(draft))}
            className="rounded bg-accent px-3 py-1.5 text-sm text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
          >
            {uiText("저장")}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function PlayGlyph({ small }: { small?: boolean }) {
  useUiLocale()
  const s = small ? 13 : 14
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

/** 실행 중인 명령의 재생 버튼 자리에 들어간다 — 누르면 그 명령의 tmux 세션이 죽는다 */
function StopGlyph() {
  useUiLocale()
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}

function TerminalGlyph() {
  useUiLocale()
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m6 9 3 3-3 3" />
      <path d="M13 15h4" />
    </svg>
  )
}
