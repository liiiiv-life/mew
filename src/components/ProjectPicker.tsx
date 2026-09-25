import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { useCallback, useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import {
  createProject,
  deleteProject,
  renameProject,
  setProjectIcon,
  setProjectLayout,
  type ProjectInfo,
} from '../api/client'
import { useGridDrag } from '../hooks/useGridDrag'
import { hasIcon } from '../utils/projectIcons'
import { buildPlacement, compactPlacement } from '../utils/projectLayout'
import { IconPicker } from './IconPicker'
import { ProjectIcon } from './ProjectIcon'

// 타일 자리(slot)는 이 열 수를 기준으로 매긴 번호라 화면 크기와 무관하게 고정한다 —
// 열 수가 화면마다 달라지면 같은 번호가 다른 자리를 가리켜 배치가 흐트러진다.
const COLS = 4

/** 아이콘이 없는 프로젝트의 대체 타일 색 — 이름에서 고정 색상(hue)을 뽑아 테마와 무관하게 유지 */
function fallbackHue(name: string): number {
  let hue = 0
  for (const ch of name) hue = (hue * 31 + (ch.codePointAt(0) ?? 0)) % 360
  return hue
}

interface ProjectPickerProps {
  projects: ProjectInfo[]
  /** 지금 보고 있는 프로젝트 — 격자에서 강조된다 */
  currentProject: string
  readOnly: boolean
  /** owner만 프로젝트를 추가·개명·삭제할 수 있다 */
  isOwner: boolean
  onClose: () => void
  /** 타일 선택 — 페이지 이동이 아니라 그 프로젝트 탭으로 옮기는 것이다 (App이 처리) */
  onSelect: (name: string) => void
  onIconChanged: (project: string, icon: string | null) => void
  onLayoutChanged: (layout: Record<string, number>) => void
  /** 프로젝트를 만들거나 지운 뒤 목록을 다시 불러오도록 호출 */
  onProjectsChanged: () => void
  /** 폴더 이름이 바뀌었다 — 열린 탭이 옛 이름을 가리키고 있으면 App이 옮겨야 한다 */
  onProjectRenamed: (oldName: string, newName: string) => void
  /** 폴더가 사라졌다 — 그 프로젝트를 보고 있었다면 App이 다른 곳으로 옮긴다 */
  onProjectDeleted: (name: string) => void
}

/** 프로젝트 탭을 꾹 눌러(우클릭) 여는 팝업 — 격자에서 고르고, 타일을 끌어 자리를 바꾼다 */
export function ProjectPicker({
  projects,
  currentProject,
  readOnly,
  isOwner,
  onClose,
  onSelect,
  onIconChanged,
  onLayoutChanged,
  onProjectsChanged,
  onProjectRenamed,
  onProjectDeleted,
}: ProjectPickerProps) {
  useUiLocale()
  const [placement, setPlacement] = useState(() => (readOnly ? compactPlacement(projects) : buildPlacement(projects)))
  const [editing, setEditing] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  const { drag, registerCell, getTileProps, consumeClick } = useGridDrag({ enabled: !readOnly, onMove: moveTile })

  // 프로젝트 목록(이름 집합)이 바뀌면 — 생성·삭제·개명 — 격자 배치를 서버 slot 기준으로 다시 만든다.
  // 아이콘만 바뀐 경우(이름 동일)엔 firing되지 않아 드래그로 옮긴 배치가 유지된다.
  const nameKey = projects.map((p) => p.name).sort().join('\n')
  useEffect(() => {
    setPlacement(readOnly ? compactPlacement(projects) : buildPlacement(projects))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameKey])

  const closeEditing = useCallback(() => {
    setEditing(null)
    setError(null)
  }, [])

  const closeDeleteDialog = useCallback(() => {
    setDeleteTarget(null)
    setDeleteConfirm('')
  }, [])

  // 겹친 창은 위에서부터 닫는다 — Esc·뒤로가기는 나중에 등록된 쪽이 먼저 받는다 (격자 < 설정 < 삭제 확인)
  useOverlayDismiss(onClose)
  useOverlayDismiss(editing !== null && closeEditing)
  useOverlayDismiss(deleteTarget !== null && closeDeleteDialog)

  /** 빈 칸이면 그리로 옮기고, 다른 타일이 있는 칸이면 서로 자리를 맞바꾼다 */
  function moveTile(from: number, to: number) {
    const previous = placement
    const next = new Map(previous)
    const moving = next.get(from)
    if (!moving) return
    const occupant = next.get(to)
    next.set(to, moving)
    if (occupant) next.set(from, occupant)
    else next.delete(from)
    setPlacement(next)
    void persistPlacement(next, previous)
  }

  async function persistPlacement(next: Map<number, string>, previous: Map<number, string>) {
    const layout: Record<string, number> = {}
    for (const [slot, name] of next) layout[name] = slot
    setError(null)
    try {
      await setProjectLayout(layout)
      onLayoutChanged(layout)
    } catch (err) {
      setPlacement(previous)
      setError(err instanceof Error ? err.message : uiText("배치 저장에 실패했습니다"))
    }
  }

  function startEditing(project: ProjectInfo) {
    setEditing(project.name)
    setNameDraft(project.name)
    setError(null)
  }

  async function handleCreateProject() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      await createProject(name)
      setCreating(false)
      setNewName('')
      onProjectsChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("프로젝트 생성에 실패했습니다"))
    } finally {
      setBusy(false)
    }
  }

  async function handleRenameProject() {
    if (!editing) return
    const next = nameDraft.trim()
    if (!next || next === editing) return
    setBusy(true)
    setError(null)
    try {
      await renameProject(editing, next)
      onProjectsChanged()
      onProjectRenamed(editing, next)
      setEditing(next)
      setNameDraft(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("이름 변경에 실패했습니다"))
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteProject() {
    if (!deleteTarget || deleteConfirm !== deleteTarget) return
    setBusy(true)
    setError(null)
    try {
      await deleteProject(deleteTarget)
      const removed = deleteTarget
      setDeleteTarget(null)
      setDeleteConfirm('')
      setEditing(null)
      onProjectsChanged()
      // 지금 보고 있던 프로젝트였다면 App이 다른 프로젝트로 옮겨 준다
      onProjectDeleted(removed)
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("프로젝트 삭제에 실패했습니다"))
    } finally {
      setBusy(false)
    }
  }

  async function saveIcon(project: string, icon: string | null, close = true) {
    setBusy(true)
    setError(null)
    try {
      // 서버가 정리한 값(SVG는 XML 선언 등이 떨어져 나간다)을 그대로 화면에 반영한다
      const saved = await setProjectIcon(project, icon)
      onIconChanged(project, saved.icon)
      if (close) setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : uiText("아이콘 저장에 실패했습니다"))
    } finally {
      setBusy(false)
    }
  }

  const byName = new Map(projects.map((p) => [p.name, p]))
  const maxSlot = placement.size > 0 ? Math.max(...placement.keys()) : 0
  // 옮겨놓을 빈 칸을 항상 하나 남겨둔다 — 드래그 도중에 줄을 늘리면 모달 높이가 변해
  // 격자가 손끝 아래에서 움직인다(놓는 자리가 밀린다).
  const rows = Math.ceil((maxSlot + 1 + (readOnly ? 0 : 1)) / COLS)
  const editingIcon = editing ? (byName.get(editing)?.icon ?? null) : null
  // 보호된 프로젝트(docs·앱 자신)는 이름 변경·삭제를 막는다 — owner라도
  const canManageEditing = isOwner && !!editing && !(byName.get(editing)?.protected ?? false)

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div
        // 타일은 aspect-square에 열 수가 COLS로 고정이라 한 변의 길이는 창 너비가 정한다.
        // 21rem = 타일 68px — 아이콘(36px)과 이름줄만 남기고 주변 여백을 걷어낸 크기다.
        className="w-full max-w-[21rem] rounded-lg border border-edge bg-surface-deep p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-semibold text-ink-bright">{uiText("프로젝트")}</div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
            aria-label={uiText("닫기")}
          >
            ×
          </button>
        </div>

        <div className="grid max-h-[55vh] grid-cols-4 gap-2 overflow-y-auto">
          {Array.from({ length: rows * COLS }, (_, slot) => {
            const p = byName.get(placement.get(slot) ?? '')
            const isDragging = drag?.slot === slot
            const isDropTarget = drag != null && drag.target === slot && drag.slot !== slot
            return (
              <div
                key={slot}
                ref={registerCell(slot)}
                className={`group relative aspect-square rounded-lg ${
                  isDropTarget ? 'ring-2 ring-accent' : ''
                } ${!p && drag ? 'border border-dashed border-edge' : ''}`}
              >
                {p && (
                  <>
                    <button
                      type="button"
                      {...getTileProps(slot)}
                      // 길게누르기로 드래그를 시작하므로 안드로이드 기본 컨텍스트 메뉴는 막는다
                      onContextMenu={(e) => e.preventDefault()}
                      onClick={() => {
                        if (consumeClick()) return
                        onSelect(p.name)
                      }}
                      className={`absolute inset-0 flex touch-manipulation select-none flex-col items-center justify-center gap-1 rounded-lg border p-1 text-ink ${
                        p.name === currentProject ? 'border-accent bg-surface-raised' : 'border-edge'
                      } ${isDragging ? 'z-20 border-edge-bright bg-surface-raised shadow-lg' : 'hover:bg-surface-raised'}`}
                      style={
                        isDragging ? { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(1.06)` } : undefined
                      }
                      title={p.name}
                    >
                      <span className="flex h-9 w-9 items-center justify-center">
                        {hasIcon(p.icon) ? (
                          <ProjectIcon icon={p.icon!} size={26} />
                        ) : (
                          <span
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-base font-semibold"
                            style={{ backgroundColor: `hsl(${fallbackHue(p.name)} 55% 50% / 0.2)` }}
                          >
                            {p.name[0].toUpperCase()}
                          </span>
                        )}
                      </span>
                      <span className="w-full truncate px-0.5 text-center text-[11px] text-ink-secondary">
                        {p.name}
                      </span>
                    </button>
                    {!readOnly && !drag && (
                      <button
                        type="button"
                        onClick={() => startEditing(p)}
                        className="absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                        title={uiText("{p0} 아이콘 설정", { p0: p.name })}
                        aria-label={uiText("{p0} 아이콘 설정", { p0: p.name })}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>

        {!readOnly && (
          <div className="mt-3 text-[11px] text-ink-muted">
            {uiText("끌어서 순서 변경 · 터치는 길게 누르기")}</div>
        )}

        {isOwner && (
          <div className="mt-3 border-t border-edge pt-3">
            {creating ? (
              <div className="flex items-center gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleCreateProject()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setCreating(false)
                      setNewName('')
                    }
                  }}
                  placeholder={uiText("새 프로젝트 이름")}
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-edge-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
                />
                <button
                  type="button"
                  onClick={handleCreateProject}
                  disabled={busy || !newName.trim()}
                  className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
                >
                  {uiText("만들기")}</button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false)
                    setNewName('')
                  }}
                  className="rounded border border-edge-strong px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-raised"
                >
                  {uiText("취소")}</button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true)
                  setError(null)
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-edge-strong px-3 py-2 text-sm text-ink-secondary hover:bg-surface-raised hover:text-ink"
              >
                {uiText("＋ 새 프로젝트")}</button>
            )}
          </div>
        )}

        {error && !editing && !deleteTarget && <div className="select-text mt-2 text-sm text-danger">{error}</div>}
      </div>
    </div>

    {/* 설정은 격자 위에 따로 띄운다 — 격자 아래에 붙여 놓으면 창이 세로로 길어져 아래가 잘린다 */}
    {editing && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4" onClick={closeEditing}>
        <div
          className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-edge bg-surface-deep p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold text-ink-bright">{uiText("{p0} 설정", { p0: editing })}</div>
            <button
              type="button"
              onClick={closeEditing}
              className="flex h-7 w-7 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink"
              aria-label={uiText("닫기")}
            >
              ×
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {canManageEditing && (
              <div className="mb-3">
                <div className="mb-1 text-[11px] text-ink-muted">{uiText("이름 변경")}</div>
                <div className="flex items-center gap-2">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleRenameProject()
                      }
                    }}
                    placeholder={uiText("프로젝트 이름")}
                    className="min-w-0 flex-1 rounded border border-edge-strong bg-surface px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
                  />
                  <button
                    type="button"
                    onClick={handleRenameProject}
                    disabled={busy || !nameDraft.trim() || nameDraft.trim() === editing}
                    className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
                  >
                    {uiText("변경")}</button>
                </div>
              </div>
            )}
            <div className="mb-1 text-[11px] text-ink-muted">{uiText("아이콘")}</div>
            {/* 고르는 순간 서버에 저장하고 창은 열어둔다 — 격자 타일에 바로 반영돼 골라 가며 볼 수 있다.
                key=프로젝트: 다른 프로젝트를 열면 이모지·SVG 칸이 그 프로젝트 값으로 다시 시작한다 */}
            <IconPicker
              key={editing}
              value={editingIcon ?? ''}
              disabled={busy}
              onChange={(icon) => void saveIcon(editing, icon || null, false)}
            />
            {canManageEditing && (
              <div className="mt-4 border-t border-edge pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteTarget(editing)
                    setDeleteConfirm('')
                    setError(null)
                  }}
                  className="w-full rounded border border-danger px-3 py-2 text-sm text-danger-strong hover:bg-surface-raised"
                >
                  {uiText("프로젝트 삭제…")}</button>
              </div>
            )}
          </div>

          {error && !deleteTarget && <div className="select-text mt-3 text-sm text-danger">{error}</div>}
        </div>
      </div>
    )}

    {deleteTarget && (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4"
        onClick={closeDeleteDialog}
      >
        <div className="w-full max-w-sm rounded-lg border border-danger bg-surface-deep p-5" onClick={(e) => e.stopPropagation()}>
          <div className="text-sm font-semibold text-danger-strong">{uiText("프로젝트 삭제")}</div>
          <div className="mt-2 text-sm text-ink-secondary">
            {uiText("{name} 프로젝트를 삭제하면 폴더와 그 안의 모든 파일이 영구히 사라집니다. 이 작업은 되돌릴 수 없습니다.", { name: deleteTarget })}</div>
          <div className="mt-3 text-xs text-ink-muted">
            {uiText("확인을 위해 프로젝트 이름 {name}을(를) 그대로 입력하세요.", { name: deleteTarget })}</div>
          <input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && deleteConfirm === deleteTarget) {
                e.preventDefault()
                void handleDeleteProject()
              }
            }}
            placeholder={deleteTarget}
            autoFocus
            className="mt-2 w-full rounded border border-edge-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-danger"
          />
          {error && <div className="select-text mt-2 text-sm text-danger">{error}</div>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDeleteDialog}
              className="rounded border border-edge-strong px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
            >
              {uiText("취소")}</button>
            <button
              type="button"
              onClick={handleDeleteProject}
              disabled={busy || deleteConfirm !== deleteTarget}
              className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-ink-on-danger hover:bg-danger-strong disabled:opacity-40"
            >
              {uiText("영구 삭제")}</button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
