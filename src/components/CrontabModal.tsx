// 서버가 도는 계정의 crontab을 그대로 보고 고치는 팝업 — 도구 줄의 시계 아이콘으로 연다.
// 저장은 전체 텍스트를 통째로 `crontab -`에 흘려보내 교체한다(부분 수정 없음).
import { useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { fetchCrontab, saveCrontab } from '../api/client'

export function CrontabModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchCrontab()
      .then((res) => setText(res.text))
      .catch((err) => setError(err instanceof Error ? err.message : '불러오기 실패'))
  }, [])

  useOverlayDismiss(onClose)

  async function save() {
    if (text === null || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await saveCrontab(text)
      setText(res.text)
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-edge-bright bg-surface-raised p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-sm font-semibold text-ink">crontab</div>
        <div className="mb-3 text-[11px] text-ink-muted">서버 계정의 예약 작업 — 줄 형식은 분 시 일 월 요일 명령</div>

        {text === null && !error ? (
          <div className="py-6 text-center text-xs text-ink-muted">불러오는 중…</div>
        ) : (
          <textarea
            value={text ?? ''}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="# 예약 작업이 없습니다"
            className="mb-3 w-full flex-1 resize-none rounded border border-edge-strong bg-surface px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
          />
        )}

        {error && <div className="mb-2 text-xs text-danger-strong">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-edge-strong px-3 py-1.5 text-sm text-ink hover:bg-surface"
          >
            닫기
          </button>
          <button
            type="button"
            disabled={busy || text === null}
            onClick={save}
            className="rounded bg-accent px-3 py-1.5 text-sm text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
