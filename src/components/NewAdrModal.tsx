import { useEffect, useState } from 'react'
import { createNewAdr, fetchNextAdrNumber } from '../api/client'

export function NewAdrModal({ onClose, onCreated }: { onClose: () => void; onCreated: (relPath: string) => void }) {
  const [number, setNumber] = useState<string | null>(null)
  const [scope, setScope] = useState('')
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchNextAdrNumber().then(({ number }) => setNumber(number)).catch(console.error)
  }, [])

  async function handleCreate() {
    if (!scope.trim() || !title.trim()) return
    setCreating(true)
    setError(null)
    try {
      const { relPath } = await createNewAdr(scope.trim(), title.trim())
      onCreated(relPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-lg bg-surface p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 text-base font-semibold text-ink">새 ADR</div>
        <div className="mb-3 text-ink-secondary">
          다음 번호: <span className="font-mono">{number ?? '…'}</span>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-ink-secondary">스코프 (company · platform · 제품명 · ops · docs)</label>
          <input
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="sleeeep"
            className="w-full rounded border border-edge-strong bg-surface-raised px-2 py-1 text-ink"
          />
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-ink-secondary">결정 제목</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="영문 제목"
            autoFocus
            className="w-full rounded border border-edge-strong bg-surface-raised px-2 py-1 text-ink"
          />
        </div>

        {number && scope && title && (
          <div className="mb-3 rounded bg-surface-raised px-2 py-1 font-mono text-xs text-ink-secondary">
            decisions/{number}-{scope.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}-{title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md
          </div>
        )}

        {error && <div className="mb-3 text-danger">{error}</div>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-1 text-ink-secondary hover:bg-surface-raised">
            취소
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!scope.trim() || !title.trim() || creating}
            className="rounded bg-surface-inverse px-3 py-1 text-ink-inverse disabled:opacity-40"
          >
            {creating ? '생성 중…' : '생성'}
          </button>
        </div>
      </div>
    </div>
  )
}
