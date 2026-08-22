// 에이전트 런타임 설정 팝업 — 실행 파일·추가 인자·공급자 env(API 키·엔드포인트)를 런타임별로 저장한다.
// 시크릿은 서버에만 남고 브라우저로는 마지막 4자만 돌아오므로, 이 창에서 되찾을 방법은 없다 —
// 덮어써야 바꿀 수 있다. 저장 즉시 다음 spawn부터 적용된다.
import { useEffect, useState } from 'react'
import {
  deleteAgentRuntimeSetting,
  fetchAgentRuntimeSetting,
  saveAgentRuntimeSetting,
  type RuntimeSettingView,
} from '../api/client'

const GEAR_GLYPH = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export function RuntimeSettingsButton({ runtimeId, label }: { runtimeId: string; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-surface-hover hover:text-ink"
        aria-label={`${label} 설정`}
        title={`${label} 설정`}
      >
        {GEAR_GLYPH}
      </button>
      {open && <RuntimeSettingsModal runtimeId={runtimeId} label={label} onClose={() => setOpen(false)} />}
    </>
  )
}

/** env 한 줄 — 키와 값. 값 input은 password 타입(시크릿)과 text(엔드포인트 등)를 같은 줄에서 섞어 쓴다 */
type EnvRow = { key: string; value: string; secret: boolean }

function RuntimeSettingsModal({ runtimeId, label, onClose }: { runtimeId: string; label: string; onClose: () => void }) {
  const [cmd, setCmd] = useState('')
  const [extraArgs, setExtraArgs] = useState('')
  const [rows, setRows] = useState<EnvRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState(false)

  useEffect(() => {
    let alive = true
    fetchAgentRuntimeSetting(runtimeId)
      .then(({ settings }) => {
        if (!alive || !settings) {
          setLoaded(true)
          return
        }
        setCmd(settings.cmd ?? '')
        setExtraArgs((settings.extraArgs ?? []).join(' '))
        // 마스킹된 값(****xxxx)은 그대로 보여 준다 — 저장하면 그 문자열이 통째로 새 값이 되므로
        // 건드리지 않은 줄은 서버 값이 유지되고, 고친 줄만 새 값이 된다(아래 buildPayload).
        setRows(
          Object.entries(settings.env ?? {}).map(([key, value]) => ({
            key,
            value,
            secret: value.startsWith('****'),
          })),
        )
        setLoaded(true)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
        setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [runtimeId])

  const addRow = () => setRows((prev) => [...prev, { key: '', value: '', secret: false }])
  const updateRow = (index: number, patch: Partial<EnvRow>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index))

  const buildPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {}
    if (cmd.trim()) payload.cmd = cmd.trim()
    const args = extraArgs.split(' ').filter((arg) => arg.length > 0)
    if (args.length > 0) payload.extraArgs = args
    // env는 통째로 저장하는 게 아니라 **보낸 키만** 갈아끼우는 방식이어야 한다 — 서버에 저장된
    // 시크릿은 마스킹으로 원문을 못 받아 오므로, 건드리지 않은 줄(****로 시작)은 보내지 않고
    // 서버가 기존 값을 유지하게 해야 한다. 그래서 PUT은 "전체 교체"가 아니라 "병합 저장"이다.
    const env: Record<string, string> = {}
    for (const row of rows) {
      const key = row.key.trim()
      const value = row.value.trim()
      if (!key || !value) continue
      if (value.startsWith('****')) continue // 마스킹값 — 서버의 기존 값을 유지한다
      env[key] = value
    }
    if (Object.keys(env).length > 0) payload.env = env
    return payload
  }

  const hasMaskedUntouched = rows.some((row) => row.value.startsWith('****') && row.key.trim().length > 0)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveAgentRuntimeSetting(runtimeId, buildPayload())
      setSavedNote(true)
      setTimeout(() => onClose(), 600)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const reset = async () => {
    setSaving(true)
    setError(null)
    try {
      await deleteAgentRuntimeSetting(runtimeId)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onPointerDown={(e) => e.stopPropagation()}>
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-edge-bright bg-surface-raised shadow-xl">
        <div className="border-b border-edge px-4 py-3">
          <div className="text-sm font-semibold text-ink">{label} 설정</div>
          <div className="mt-0.5 text-xs text-ink-muted">실행 파일·공급자 설정을 이 런타임 전역으로 바꾼다. 다음 세션부터 적용된다.</div>
        </div>
        {!loaded ? (
          <div className="px-4 py-8 text-center text-xs text-ink-muted">불러오는 중…</div>
        ) : (
          <div className="space-y-4 px-4 py-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">실행 파일</label>
              <input
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                placeholder="비우면 등록표 기본값(예: prime-agent)"
                className="w-full rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">추가 인자</label>
              <input
                value={extraArgs}
                onChange={(e) => setExtraArgs(e.target.value)}
                placeholder="기본 인자 뒤에 붙는다 — 공백으로 구분"
                className="w-full rounded border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-ink-secondary">환경 변수 (API 키·엔드포인트)</label>
                <button type="button" onClick={addRow} className="rounded px-1.5 py-0.5 text-xs text-accent hover:bg-surface-hover">
                  + 추가
                </button>
              </div>
              {rows.length === 0 && <div className="py-1 text-xs text-ink-faint">예: ANTHROPIC_API_KEY · OPENAI_API_KEY · PRIME_API_KEY</div>}
              <div className="space-y-1">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <input
                      value={row.key}
                      onChange={(e) => updateRow(i, { key: e.target.value.toUpperCase() })}
                      placeholder="KEY"
                      className="w-2/5 rounded border border-edge bg-surface px-2 py-1 font-mono text-xs text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
                    />
                    <input
                      value={row.value}
                      onChange={(e) => updateRow(i, { value: e.target.value })}
                      placeholder="값"
                      type={row.secret && row.value.startsWith('****') ? 'text' : 'text'}
                      className="min-w-0 flex-1 rounded border border-edge bg-surface px-2 py-1 font-mono text-xs text-ink outline-none placeholder:text-ink-faint focus:border-edge-bright"
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="shrink-0 rounded px-1.5 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink"
                      aria-label="줄 삭제"
                      title="줄 삭제"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {hasMaskedUntouched && (
                <div className="mt-1 text-[11px] leading-snug text-warning">
                  ****로 시작하는 값은 서버에 저장된 기존 값을 그대로 덮어씁니다 — 바꾸려면 전체 값을 새로 입력하세요.
                </div>
              )}
            </div>
            {error && <div className="whitespace-pre-wrap rounded border border-danger/40 bg-surface px-2 py-1.5 text-xs text-danger">{error}</div>}
            {savedNote && <div className="text-xs text-accent">저장했습니다.</div>}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-edge px-4 py-2.5">
          <button
            type="button"
            onClick={reset}
            disabled={saving}
            className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-hover hover:text-ink disabled:opacity-40"
          >
            기본값으로 되돌리기
          </button>
          <div className="flex gap-1.5">
            <button type="button" onClick={onClose} className="rounded border border-edge px-3 py-1 text-xs text-ink-secondary hover:bg-surface-hover hover:text-ink">
              취소
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !loaded}
              className="rounded bg-accent px-3 py-1 text-xs text-ink-on-accent hover:bg-accent-strong disabled:opacity-40"
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// 뷰 타입 재노출 — 팝업 소비자가 필요로 하진 않지만 임포트 정리용으로 남긴다
export type { RuntimeSettingView }
