// 터미널 버튼 줄(선택 모드 버튼과 같은 줄)의 명령어 버튼. 목록은 전역 하나
// (.data/term-button.json)라 모든 프로젝트·모든 터미널 탭이 같은 버튼을 본다 — 프로젝트마다 따로
// 두는 헤더의 ▶ 명령어 버튼(.mew/cmd-button.json)과는 별개 기능이다.
//
// 누르면 지금 보고 있는 tmux 세션에 "타이핑 + Enter"로 들어간다(하단 입력칸 전송과 같은 경로라
// Claude Code의 /clear 같은 슬래시 명령도 그대로 제출된다). +로 추가하고, 버튼을 꾹 누르면
// (데스크톱은 우클릭) 이름·명령어·아이콘 수정과 삭제를 할 수 있다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useOverlayDismiss } from '@mew/ui'
import { fetchTermButtons, saveTermButtons, type TermButton } from '../api/client'
import { IconPicker } from './IconPicker'
import { ProjectIcon } from './ProjectIcon'
import { useI18n } from '../i18n'

const LONG_PRESS_MS = 500

// 터미널 탭을 옮기면 이 컴포넌트가 통째로 다시 마운트된다 — 마지막 목록을 모듈에 남겨 두면
// 다시 불러오는 동안 버튼이 사라졌다 나타나는 깜빡임이 없다.
let cachedButtons: TermButton[] | null = null

/** 편집 중인 버튼. index가 null이면 새로 추가하는 중 */
type Editing = { index: number | null; name: string; command: string; icon: string; iconOnly: boolean }

export function TermButtonBar({ run }: { run: (command: string) => void }) {
  const { t } = useI18n()
  const [buttons, setButtons] = useState<TermButton[] | null>(cachedButtons)
  const [editing, setEditing] = useState<Editing | null>(null)

  useEffect(() => {
    fetchTermButtons()
      .then((res) => {
        cachedButtons = res.buttons
        setButtons(res.buttons)
      })
      .catch(() => setButtons((prev) => prev ?? []))
  }, [])

  const commit = useCallback(async (next: TermButton[]) => {
    const res = await saveTermButtons(next)
    cachedButtons = res.buttons
    setButtons(res.buttons)
  }, [])

  return (
    <>
      {(buttons ?? []).map((b, i) => (
        <TermButtonChip
          key={`${b.name}-${i}`}
          button={b}
          onRun={() => run(b.command)}
          onEdit={() => setEditing({ index: i, ...b, icon: b.icon ?? '', iconOnly: b.iconOnly ?? false })}
        />
      ))}
      <button
        type="button"
        onClick={() => setEditing({ index: null, name: '', command: '', icon: '', iconOnly: false })}
        data-tip={t('term.addButton')}
        aria-label={t('term.addButton')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-dashed border-edge text-sm leading-none text-ink-muted hover:border-edge-strong hover:bg-surface-raised hover:text-ink"
      >
        +
      </button>

      {editing && (
        <TermButtonEditor
          editing={editing}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            const base = buttons ?? []
            const next =
              draft.index === null
                ? [...base, toButton(draft)]
                : base.map((b, i) => (i === draft.index ? toButton(draft) : b))
            await commit(next)
            setEditing(null)
          }}
          onDelete={
            editing.index === null
              ? undefined
              : async () => {
                  await commit((buttons ?? []).filter((_, i) => i !== editing.index))
                  setEditing(null)
                }
          }
        />
      )}
    </>
  )
}

function toButton(draft: Editing): TermButton {
  const name = draft.name.trim()
  const command = draft.command.trim()
  const icon = draft.icon.trim()
  if (!icon) return { name, command } // 아이콘이 없으면 숨길 이름도 없다 — iconOnly는 딸려 가지 않는다
  return draft.iconOnly ? { name, command, icon, iconOnly: true } : { name, command, icon }
}

/**
 * 짧게 누르면 실행, 꾹 누르면(모바일) 또는 우클릭하면(데스크톱) 편집.
 * 이름표는 title이 아니라 data-tip으로 단다 — 버튼 줄을 감싼 HoverTipLayer가 기다림 없이 띄운다.
 */
function TermButtonChip({ button, onRun, onEdit }: { button: TermButton; onRun: () => void; onEdit: () => void }) {
  const timerRef = useRef<number | null>(null)
  const longFiredRef = useRef(false)
  // 아이콘만 보이기로 한 버튼 — 아이콘이 없으면 텅 빈 칸이 되므로 그때는 이름을 그대로 둔다
  const iconOnly = !!button.icon && !!button.iconOnly

  const cancelPress = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => cancelPress, [cancelPress])

  return (
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
        // 꾹 눌러 편집을 연 뒤 손을 떼면 click이 뒤따라 온다 — 그 한 번은 실행하지 않는다
        if (longFiredRef.current) {
          longFiredRef.current = false
          return
        }
        onRun()
      }}
      onContextMenu={(e) => {
        // 모바일 롱프레스가 부르는 네이티브 메뉴를 막고, 데스크톱에서는 우클릭 = 편집
        e.preventDefault()
        if (!longFiredRef.current) onEdit()
      }}
      data-tip={button.name}
      aria-label={button.name}
      className={`flex shrink-0 select-none items-center gap-1 whitespace-nowrap rounded border border-edge py-0.5 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink ${
        iconOnly ? 'px-1.5' : 'px-2'
      }`}
      style={{ touchAction: 'manipulation' }}
    >
      {button.icon && <ProjectIcon icon={button.icon} size={iconOnly ? 15 : 13} />}
      {!iconOnly && button.name}
    </button>
  )
}

function TermButtonEditor({
  editing,
  onSave,
  onCancel,
  onDelete,
}: {
  editing: Editing
  onSave: (draft: Editing) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void>
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const canSave = draft.name.trim() !== '' && draft.command.trim() !== ''

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  // Esc·모바일 뒤로가기로 이 창만 닫는다 — 스택 맨 위라 터미널 패널은 그대로 남는다
  useOverlayDismiss(onCancel)

  async function withBusy(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('term.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={editing.index === null ? t('term.addTitle') : t('term.editTitle')}
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="w-full max-w-sm rounded-lg border border-edge-bright bg-surface-raised p-4 shadow-xl">
        <div className="mb-3 text-sm font-medium text-ink">{editing.index === null ? t('term.addTitle') : t('term.editTitle')}</div>

        <label className="mb-1 block text-[11px] text-ink-muted">{t('term.name')}</label>
        <input
          ref={nameRef}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder={t('term.namePlaceholder')}
          className="mb-3 w-full rounded border border-edge-strong bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
        />

        <label className="mb-1 block text-[11px] text-ink-muted">{t('term.commandDescription')}</label>
        <textarea
          value={draft.command}
          onChange={(e) => setDraft({ ...draft, command: e.target.value })}
          rows={2}
          placeholder="/clear"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className="mb-3 w-full resize-none rounded border border-edge-strong bg-surface px-2 py-1.5 font-mono text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
        />

        <div className="mb-1 text-[11px] text-ink-muted">{t('term.icon')}</div>
        {/* 프로젝트 아이콘과 **같은 고르는 칸** — 목록도 SVG 직접 넣기도 그대로 쓴다 */}
        <div className="mb-2">
          <IconPicker value={draft.icon} onChange={(icon) => setDraft({ ...draft, icon })} />
        </div>

        <label
          className={`mb-3 flex items-center gap-1.5 text-xs ${draft.icon ? 'text-ink-secondary' : 'text-ink-faint'}`}
        >
          <input
            type="checkbox"
            checked={draft.iconOnly && !!draft.icon}
            disabled={!draft.icon}
            onChange={(e) => setDraft({ ...draft, iconOnly: e.target.checked })}
          />
          {t('term.iconOnly')}
        </label>

        {error && <div className="select-text mb-2 text-xs text-danger-strong">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          {onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={() => withBusy(onDelete)}
              className="mr-auto rounded border border-edge-strong px-3 py-1.5 text-sm text-danger-strong hover:bg-surface disabled:opacity-40"
            >
              {t('common.delete')}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-edge-strong px-3 py-1.5 text-sm text-ink hover:bg-surface"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy || !canSave}
            onClick={() => withBusy(() => onSave(draft))}
            className="rounded bg-accent px-3 py-1.5 text-sm text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
