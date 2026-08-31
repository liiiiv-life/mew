import { useEffect, useState } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { saveAgentSets, type AgentSet } from '../api/client'
import { RUNTIMES, runtimeOf } from './agentRuntimes'
import { cachedAgentSets, refreshAgentSets, subscribeAgentSets, updateAgentSetsCache } from '../utils/agentPickerCache'

/** 새 탭 선택기의 에이전트셋 목록. 셋은 별도 작업자가 아니라 탭 시작 프리셋이다. */
export function AgentSetPicker({ onSelect }: { onSelect: (set: AgentSet) => void }) {
  const [sets, setSets] = useState<AgentSet[] | null>(cachedAgentSets)
  const [editing, setEditing] = useState<AgentSet | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    setError(null)
    void refreshAgentSets()
      .then(setSets)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }
  useEffect(refresh, [])
  useEffect(() => subscribeAgentSets(setSets), [])

  const save = async (next: AgentSet) => {
    try {
      const others = (sets ?? []).filter((set) => set.id !== next.id)
      const { sets: saved } = await saveAgentSets([...others, next])
      updateAgentSetsCache(saved)
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const remove = async (id: string) => {
    try {
      const { sets: saved } = await saveAgentSets((sets ?? []).filter((set) => set.id !== id))
      updateAgentSetsCache(saved)
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      {sets === null ? (
        <div className="py-8 text-center text-xs text-ink-muted">에이전트셋 불러오는 중…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {sets.map((set) => {
            const runtime = runtimeOf(set.runtime)
            return (
              <div key={set.id} className="flex min-h-14 items-center gap-3 rounded-md border border-edge bg-surface px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center text-ink-secondary"><runtime.Glyph /></span>
                <button type="button" onClick={() => onSelect(set)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm text-ink">{set.name}</div>
                  <div className="truncate text-xs text-ink-muted">{runtime.label}{set.modelId ? ` · ${set.modelId}` : ''}</div>
                </button>
                <button type="button" onClick={() => setEditing(set)} className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink">수정</button>
                <button type="button" onClick={() => onSelect(set)} className="rounded px-2.5 py-1 text-xs text-accent hover:bg-surface-raised">사용</button>
              </div>
            )
          })}
          <button
            type="button"
            onClick={() => setEditing({ id: crypto.randomUUID(), name: '', role: '', runtime: RUNTIMES[0].id, modelId: '' })}
            className="flex min-h-14 items-center rounded-md border border-dashed border-edge px-3 text-left text-sm text-ink-secondary hover:bg-surface hover:text-ink"
          >
            + 새 에이전트셋 추가
          </button>
          {sets.length === 0 && <p className="text-center text-xs text-ink-muted">셋을 만들면 런타임·모델·역할을 한 번에 골라 새 탭을 열 수 있습니다.</p>}
        </div>
      )}
      {error && <div className="mt-3 whitespace-pre-wrap text-xs text-danger">{error}</div>}
      {editing && <AgentSetEditor set={editing} isNew={!sets?.some((item) => item.id === editing.id)} onSave={save} onDelete={() => remove(editing.id)} onClose={() => setEditing(null)} />}
    </>
  )
}

function AgentSetEditor({ set, isNew, onSave, onDelete, onClose }: { set: AgentSet; isNew: boolean; onSave: (set: AgentSet) => void; onDelete: () => void; onClose: () => void }) {
  const [form, setForm] = useState(set)
  useOverlayDismiss(onClose)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-surface-deep p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 text-sm text-ink">{isNew ? '새 에이전트셋' : '에이전트셋 수정'}</div>
        <div className="space-y-3">
          <label className="block"><span className="text-xs text-ink-muted">이름</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none" /></label>
          <label className="block"><span className="text-xs text-ink-muted">에이전트</span><select value={form.runtime} onChange={(e) => setForm({ ...form, runtime: e.target.value })} className="mt-1 w-full rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none">{RUNTIMES.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.label}</option>)}</select></label>
          <label className="block"><span className="text-xs text-ink-muted">모델 — 비우면 런타임 기본 모델</span><input value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} placeholder="예: gpt-5.4" className="mt-1 w-full rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted" /></label>
          <label className="block"><span className="text-xs text-ink-muted">역할 — 이 탭의 시스템 프롬프트</span><textarea value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} rows={5} className="mt-1 w-full resize-none rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none" /></label>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          {isNew ? <span /> : <button type="button" onClick={onDelete} className="rounded px-2 py-1 text-xs text-danger hover:bg-surface-raised">삭제</button>}
          <div className="flex gap-2"><button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-raised">취소</button><button type="button" onClick={() => onSave(form)} disabled={!form.name.trim() || !form.role.trim()} className="rounded bg-accent px-3 py-1.5 text-xs text-ink disabled:opacity-40">저장</button></div>
        </div>
      </div>
    </div>
  )
}
