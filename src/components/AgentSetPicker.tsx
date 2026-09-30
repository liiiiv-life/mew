import { useEffect, useState } from 'react'
import { DialogFrame, SelectField } from '@mew/ui'
import { fetchAgentModels, saveAgentSets, type AgentModelOption, type AgentThinkingOption, type AgentSet } from '../api/client'
import { RUNTIMES, runtimeOf } from './agentRuntimes'
import { cachedAgentSets, refreshAgentSets, subscribeAgentSets, updateAgentSetsCache } from '../utils/agentPickerCache'
import { useI18n } from '../i18n'
import { uuid } from '../utils/uuid'
import { panelModelState, splitCodexModelId } from '../../shared/codex-models'

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
                  <div className="truncate text-xs text-ink-muted">{runtime.label}{set.modelId ? ` · ${set.modelId}` : ''}{set.thinkingId ? ` · ${set.thinkingId}` : ''}</div>
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
  const [catalog, setCatalog] = useState<{ runtime: string; models: AgentModelOption[]; thinking?: AgentThinkingOption | null; failed: boolean } | null>(null)
  const [modelRetry, setModelRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setCatalog(null)
    void fetchAgentModels(form.runtime, controller.signal)
      .then(({ models, thinking }) => {
        if (!controller.signal.aborted) setCatalog({ runtime: form.runtime, models, thinking, failed: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setCatalog({ runtime: form.runtime, models: [], failed: true })
      })
    return () => controller.abort()
  }, [form.runtime, modelRetry])
  const currentCatalog = catalog?.runtime === form.runtime ? catalog : null
  const models = currentCatalog?.models ?? []
  const codex = form.runtime === 'codex'
  const selected = codex ? splitCodexModelId(form.modelId) : { model: form.modelId, effort: null }
  const displayModels = panelModelState(form.runtime, { currentModelId: form.modelId, availableModels: models })!.availableModels
  const efforts = codex
    ? [...new Set(models.flatMap(item => {
      const variant = splitCodexModelId(item.modelId)
      return variant.model === selected.model && variant.effort ? [variant.effort] : []
    }))].map(id => ({ id, name: currentCatalog?.thinking?.options.find(option => option.id === id)?.name ?? id }))
    : currentCatalog?.thinking?.options ?? []
  if (codex && selected.effort && !efforts.some(option => option.id === selected.effort)) {
    efforts.push({ id: selected.effort, name: selected.effort })
  }
  const changeModel = (value: string) => {
    if (!codex) { setForm({ ...form, modelId: value }); return }
    const exact = splitCodexModelId(value)
    const variants = models.filter(item => splitCodexModelId(item.modelId).model === value)
    const variant = variants.find(item => splitCodexModelId(item.modelId).effort === selected.effort)
      ?? variants.find(item => splitCodexModelId(item.modelId).effort === 'medium') ?? variants[0]
    setForm({ ...form, modelId: exact.effort ? value : variant?.modelId ?? value })
  }
  const query = selected.model.trim().toLocaleLowerCase()
  const matchingModels = displayModels.some(model => model.modelId === selected.model)
    ? displayModels
    : displayModels.filter(model => `${model.name} ${model.modelId}`.toLocaleLowerCase().includes(query))
  const modelOptions = [
    { value: '', label: t('agentSet.defaultModel') },
    ...matchingModels.map(model => ({ value: model.modelId, label: model.name === model.modelId ? model.name : `${model.name} · ${model.modelId}` })),
    ...(!currentCatalog || (!currentCatalog.failed && matchingModels.length === 0)
      ? [{ value: '__model_status__', label: t(!currentCatalog ? 'common.loading' : 'agentSet.noModels'), disabled: true }]
      : []),
  ]
  return (
    <DialogFrame labelledBy="agent-set-editor-title" onClose={onClose} busy={saving}>
      <div className="p-4">
        <div id="agent-set-editor-title" className="mb-3 text-sm text-ink">{isNew ? t('agentSet.new') : t('agentSet.editTitle')}</div>
        <div className="space-y-3">
          <label className="block"><span className="text-xs text-ink-muted">{t('agentSet.name')}</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded bg-surface px-2 py-1.5 text-sm text-ink outline-none" /></label>
          <div><div className="mb-1 text-xs text-ink-muted">{t('agentSet.agent')}</div><SelectField label={t('agentSet.agent')} value={form.runtime} disabled={saving} onChange={(runtime) => setForm({ ...form, runtime, modelId: '', thinkingId: undefined, thinkingConfigId: undefined })} options={AGENT_SET_RUNTIMES.map((runtime) => ({ value: runtime.id, label: runtime.label }))} /></div>
          <div>
            <div className="mb-1 text-xs text-ink-muted">{t('agentSet.model')}</div>
            <SelectField key={form.runtime} editable label={t('agentSet.model')} value={selected.model} options={modelOptions} disabled={saving} onChange={changeModel} />
            {currentCatalog?.failed && <div className="mt-1 flex items-center gap-2 text-xs">
              <span role="alert" className="text-danger">{t('agentSet.modelsFailed')}</span>
              <button type="button" disabled={saving} onClick={() => setModelRetry(value => value + 1)} className="shrink-0 rounded px-1 py-1 text-accent hover:bg-surface-raised disabled:opacity-40">{t('project.retry')}</button>
            </div>}
          </div>
          {(efforts.length > 0 || (!codex && form.thinkingId)) && <div>
            <div className="mb-1 text-xs text-ink-muted">{t('agentSet.effort')}</div>
            <SelectField label={t('agentSet.effort')} disabled={saving} value={codex ? selected.effort ?? '' : form.thinkingId ?? ''}
              options={[
                ...(!codex ? [{ value: '', label: t('agentSet.defaultEffort') }] : []),
                ...efforts.map(option => ({ value: option.id, label: option.name })),
                ...(!codex && form.thinkingId && !efforts.some(option => option.id === form.thinkingId)
                  ? [{ value: form.thinkingId, label: form.thinkingId }] : []),
              ]}
              onChange={value => setForm(codex
                ? { ...form, modelId: models.find(item => { const variant = splitCodexModelId(item.modelId); return variant.model === selected.model && variant.effort === value })?.modelId ?? form.modelId }
                : { ...form, thinkingId: value || undefined, thinkingConfigId: value ? currentCatalog?.thinking?.configId ?? form.thinkingConfigId : undefined })} />
          </div>}
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
