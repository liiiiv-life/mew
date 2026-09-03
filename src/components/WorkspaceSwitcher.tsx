// 워크스페이스 바꾸기 — 홈 탭을 꾹 누르거나 우클릭하면 열린다(owner 전용).
//
// 두 걸음이다: 폴더를 고르고(FolderPicker), 그 안에서 프로젝트로 잡히는 것들을 보여준 뒤 확인받는다.
// 폴더 하나가 곧 프로젝트 하나라 "감지"라고 할 것도 없다 — 하위 폴더 목록이 그대로 프로젝트 목록이다.
// 바꾸고 나면 열린 탭·트리가 전부 남의 폴더 것이라 페이지를 다시 띄운다.
import { useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { browseDirs, fetchWorkspace, forgetSavedProject, switchWorkspace } from '../api/client'
import { FolderPicker } from './FolderPicker'

export function WorkspaceSwitcher({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    fetchWorkspace()
      .then((w) => setCurrent(w.path))
      .catch(() => setCurrent(null))
  }, [])

  if (picked) return <ConfirmSwitch target={picked} onBack={() => setPicked(null)} onClose={onClose} />

  return (
    <FolderPicker
      title="워크스페이스 바꾸기"
      hint={current ? `지금: ${current}` : undefined}
      confirmLabel="이 폴더 열기"
      onPick={setPicked}
      onClose={onClose}
    />
  )
}

function ConfirmSwitch({ target, onBack, onClose }: { target: string; onBack: () => void; onClose: () => void }) {
  const [projects, setProjects] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useOverlayDismiss(onClose)

  useEffect(() => {
    browseDirs(target)
      .then((r) => setProjects(r.dirs.map((d) => d.name)))
      .catch((e) => setError(e instanceof Error ? e.message : '폴더를 읽지 못했습니다'))
  }, [target])

  const apply = () => {
    setBusy(true)
    setError(null)
    switchWorkspace(target)
      .then(() => {
        // 기억해 둔 프로젝트는 옛 워크스페이스 것이다 — 버리고 통째로 다시 띄운다
        forgetSavedProject()
        location.reload()
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : '워크스페이스를 바꾸지 못했습니다')
        setBusy(false)
      })
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 text-sm font-semibold text-ink">이 폴더를 워크스페이스로 열까요?</div>
        <div className="border-t border-edge px-3 py-2 font-mono text-[11px] text-ink-secondary">{target}</div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-edge px-3 py-2">
          {error ? (
            <div className="text-xs text-danger-strong">{error}</div>
          ) : projects === null ? (
            <div className="text-xs text-ink-muted">읽는 중…</div>
          ) : projects.length === 0 ? (
            <div className="text-xs text-ink-muted">아직 프로젝트가 없습니다</div>
          ) : (
            <>
              <div className="pb-1 text-xs text-ink-muted">프로젝트 {projects.length}개</div>
              <div className="flex flex-wrap gap-1">
                {projects.map((name) => (
                  <span key={name} className="rounded bg-surface px-1.5 py-0.5 text-xs text-ink-secondary">
                    {name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="border-t border-edge bg-warning-surface px-3 py-2 text-xs text-warning-ink">
          바꾸면 열려 있는 모든 화면이 새로 뜹니다. 터미널 세션은 이미 열려 있던 폴더에 그대로 남습니다.
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-edge px-3 py-2">
          <button type="button" onClick={onBack} className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-hover">
            뒤로
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={apply}
            className="rounded bg-accent px-2.5 py-1 text-xs text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
          >
            {busy ? '바꾸는 중…' : '워크스페이스 바꾸기'}
          </button>
        </div>
      </div>
    </div>
  )
}
