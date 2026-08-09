// docs 탭을 우클릭(모바일에선 꾹)하면 뜨는 창 — 폴더 통째로 가져오기/내보내기 둘뿐이다.
// docs는 프로젝트가 아니라 워크스페이스에 하나뿐인 특별 레포라(paths.ts) 이름 바꾸기·삭제가 없다.
import { useState } from 'react'
import { ConfirmDialog, useOverlayDismiss } from '@mew/ui'
import { exportDocs, importDocs } from '../api/client'
import { FolderPicker } from './FolderPicker'

export function DocsSettingsModal({ onDone, onClose }: { onDone: (message: string) => void; onClose: () => void }) {
  const [picking, setPicking] = useState<'import' | 'export' | null>(null)
  // 가져오기는 기존 docs를 지운다 — 폴더를 고른 뒤 한 번 더 확인을 받는다
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useOverlayDismiss(onClose)

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setError(null)
    try {
      onDone(await action())
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  if (confirming !== null) {
    return (
      <ConfirmDialog
        message="지금 docs에 있는 내용은 모두 삭제됩니다."
        detail={`${confirming} 의 내용으로 docs를 덮어씁니다. 되돌릴 수 없습니다.`}
        confirmLabel="가져오기"
        danger
        onConfirm={() => {
          const from = confirming
          setConfirming(null)
          void run(async () => {
            await importDocs(from)
            return 'docs를 가져왔습니다'
          })
        }}
        onCancel={() => setConfirming(null)}
      />
    )
  }

  if (picking === 'import') {
    return (
      <FolderPicker
        title="docs 가져오기 — 불러올 폴더"
        hint="고른 폴더의 내용이 docs가 됩니다. 지금 docs에 있는 내용은 모두 삭제됩니다."
        confirmLabel="이 폴더에서 가져오기"
        busy={busy}
        onPick={(path) => setConfirming(path)}
        onClose={() => setPicking(null)}
      />
    )
  }

  if (picking === 'export') {
    return (
      <FolderPicker
        title="docs 내보내기 — 복사할 위치"
        hint="고른 폴더 안에 docs 폴더가 그대로 복사됩니다."
        confirmLabel="여기로 내보내기"
        busy={busy}
        onPick={(path) =>
          void run(async () => {
            const { path: dest } = await exportDocs(path)
            return `${dest}(으)로 내보냈습니다`
          })
        }
        onClose={() => setPicking(null)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-xs overflow-hidden rounded-lg border border-edge-bright bg-surface-raised shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2.5 text-sm font-semibold text-ink">docs</div>
        {error && <div className="border-t border-edge px-3 py-2 text-xs text-danger-ink">{error}</div>}
        <button
          type="button"
          disabled={busy}
          onClick={() => setPicking('import')}
          className="flex w-full flex-col gap-0.5 border-t border-edge px-3 py-2.5 text-left hover:bg-surface-hover disabled:opacity-40"
        >
          <span className="text-xs text-ink">가져오기</span>
          <span className="text-[11px] text-ink-muted">외부 폴더의 내용으로 docs를 덮어씁니다</span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPicking('export')}
          className="flex w-full flex-col gap-0.5 border-t border-edge px-3 py-2.5 text-left hover:bg-surface-hover disabled:opacity-40"
        >
          <span className="text-xs text-ink">내보내기</span>
          <span className="text-[11px] text-ink-muted">docs 폴더를 고른 위치로 복사합니다</span>
        </button>
      </div>
    </div>
  )
}
