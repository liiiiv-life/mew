import { useEffect, useState } from 'react'
import { DialogFrame } from '@mew/ui'
import { saveAgentSets, type AgentSet } from '../api/client'
import { RUNTIMES, runtimeOf } from './agentRuntimes'
import { cachedAgentSets, refreshAgentSets, subscribeAgentSets, updateAgentSetsCache } from '../utils/agentPickerCache'
import { useI18n } from '../i18n'
import { uuid } from '../utils/uuid'

const AGENT_SET_RUNTIMES = RUNTIMES.filter((runtime) => runtime.surface === 'acp')

/** 새 탭 선택기의 에이전트셋 목록. 셋은 별도 작업자가 아니라 탭 시작 프리셋이다. */
export function AgentSetPicker({ onSelect, onCreated }: { onSelect: (set: AgentSet) => void; onCreated?: (set: AgentSet) => void }) {
  const { t } = useI18n()
  const [sets, setSets] = useState<AgentSet[] | null>(cachedAgentSets)
  const [editing, setEditing] = useState<AgentSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = () => {
    setError(null)
    void refreshAgentSets()
      .then(setSets)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }
  useEffect(refresh, [])
  useEffect(() => subscribeAgentSets(setSets), [])

  const save = async (next: AgentSet) => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const others = (sets ?? []).filter((set) => set.id !== next.id)
      const { sets: saved } = await saveAgentSets([...others, next])
      updateAgentSetsCache(saved)
      setEditing(null)
      if (!sets?.some(set => set.id === next.id)) onCreated?.(saved.find(set => set.id === next.id)!)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setSaving(false) }
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
        <div className="py-8 text-center text-xs text-ink-muted">{t('agentSet.loading')}</div>
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
                <button type="button" onClick={() => setEditing(set)} className="rounded px-2 py-1 text-xs text-ink-secondary hover:bg-surface-raised hover:text-ink">{t('agentSet.edit')}</button>
                <button type="button" onClick={() => onSelect(set)} className="rounded px-2.5 py-1 text-xs text-accent hover:bg-surface-raised">{t('agentSet.use')}</button>
              </div>
            )
          })}
          <button
            type="button"
            onClick={() => setEditing({ id: uuid(), name: '', role: '', runtime: AGENT_SET_RUNTIMES[0].id, modelId: '' })}
            className="flex min-h-14 items-center rounded-md border border-dashed border-edge px-3 text-left text-sm text-ink-secondary hover:bg-surface hover:text-ink"
          >
            {t('agentSet.add')}
          </button>
          {sets.length === 0 && <div className="py-2 text-center text-xs text-ink-muted">{t('agentSet.none')}</div>}
        </div>
      )}
      {error && !editing && <div role="alert" className="select-text mt-3 whitespace-pre-wrap text-xs text-danger">{error}</div>}
      {editing && <AgentSetEditor set={editing} error={error} saving={saving} isNew={!sets?.some((item) => item.id === editing.id)} onSave={save} onDelete={() => remove(editing.id)} onClose={() => setEditing(null)} />}
    </>
  )
}

function AgentSetEditor({ set, error, saving, isNew, onSave, onDelete, onClose }: { set: AgentSet; error: string | null; saving: boolean; isNew: boolean; onSave: (set: AgentSet) => void; onDelete: () => void; onClose: () => void }) {
  const { t } = useI18n()
  const [form, setForm] = useState(set)
  return (
    <DialogFrame labelledBy="agent-set-editor-title" onClose={onClose} busy={saving}>
      <div className="p-4">
        <div id="agent-set-editor-title" className="mb-3 text-sm text-ink">{isNew ? t('agentSet.new') : t('agentSet.editTitle')}</div>
        <div className="space-y-3">
          <label className="block"><span className="text-xs text-ink-muted">{t('agentSet.name')}</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none" /></label>
          <label className="block"><span className="text-xs text-ink-muted">{t('agentSet.agent')}</span><select value={form.runtime} onChange={(e) => setForm({ ...form, runtime: e.target.value })} className="mt-1 w-full rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none">{AGENT_SET_RUNTIMES.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.label}</option>)}</select></label>
          <label className="block"><span className="text-xs text-ink-muted">{t('agentSet.model')}</span><input value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} placeholder="e.g. gpt-5.4" className="mt-1 w-full rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-muted" /></label>
          <label className="block"><span className="text-xs text-ink-muted">{t('agentSet.role')}</span><textarea value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} rows={5} className="mt-1 w-full resize-none rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none" /></label>
        </div>
        {error && <p role="alert" className="mt-3 whitespace-pre-wrap text-xs text-danger">{error}</p>}
        <div className="mt-4 flex items-center justify-between gap-2">
          {isNew ? <span /> : <button type="button" disabled={saving} onClick={onDelete} className="rounded px-2 py-1 text-xs text-danger hover:bg-surface-raised">{t('common.delete')}</button>}
          <div className="flex gap-2"><button type="button" disabled={saving} onClick={onClose} className="rounded px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-raised">{t('common.cancel')}</button><button type="button" onClick={() => onSave(form)} disabled={saving || !form.name.trim() || !form.role.trim()} className="rounded bg-accent px-3 py-1.5 text-xs text-ink-on-accent disabled:opacity-40">{t('common.save')}</button></div>
        </div>
      </div>
    </DialogFrame>
  )
}
