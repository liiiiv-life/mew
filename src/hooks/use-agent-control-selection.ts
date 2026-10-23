import { useCallback, useMemo, useState } from 'react'
import { splitCodexModelId } from '../../shared/codex-models'
import type { ModelState, ModeState, ThinkingState } from '../utils/agentFold'

type Pending = { modelId?: string; thinkingId?: string; modeId?: string }

function resolveModel(runtime: string, models: ModelState, modelId: string, effort?: string) {
  if (runtime !== 'codex' || models.availableModels.some(model => model.modelId === modelId)) return modelId
  const variants = models.availableModels.filter(model => splitCodexModelId(model.modelId).model === modelId)
  return (variants.find(model => splitCodexModelId(model.modelId).effort === effort)
    ?? variants.find(model => splitCodexModelId(model.modelId).effort === 'medium')
    ?? variants[0])?.modelId ?? modelId
}

/** Keep selection feedback independent of ACP latency; server events still own confirmed state. */
export function useAgentControlSelection(runtime: string, confirmedModels: ModelState | null, confirmedModes: ModeState | null, confirmedThinking: ThinkingState | null) {
  const [pending, setPending] = useState<Pending>({})
  const models = useMemo(() => confirmedModels && pending.modelId !== undefined
    ? { ...confirmedModels, currentModelId: pending.modelId } : confirmedModels, [confirmedModels, pending.modelId])
  const modes = useMemo(() => confirmedModes && pending.modeId !== undefined
    ? { ...confirmedModes, currentModeId: pending.modeId } : confirmedModes, [confirmedModes, pending.modeId])
  const thinking = useMemo(() => {
    if (!confirmedThinking || (pending.thinkingId === undefined && pending.modelId === undefined)) return confirmedThinking
    let options = confirmedThinking.options
    if (runtime === 'codex' && models) {
      const selectedModel = splitCodexModelId(models.currentModelId).model
      const efforts = [...new Set(models.availableModels.flatMap(item => {
        const { model, effort } = splitCodexModelId(item.modelId)
        return model === selectedModel && effort ? [effort] : []
      }))]
      if (efforts.length) options = efforts.map(id => confirmedThinking.options.find(option => option.id === id) ?? { id, name: id.charAt(0).toUpperCase() + id.slice(1) })
    }
    return { ...confirmedThinking, currentValue: pending.thinkingId ?? confirmedThinking.currentValue, options }
  }, [confirmedThinking, models, pending.modelId, pending.thinkingId, runtime])
  const selectModel = (modelId: string) => {
    if (!models) return modelId
    const exact = resolveModel(runtime, models, modelId, thinking?.currentValue)
    const effort = runtime === 'codex' ? splitCodexModelId(exact).effort : null
    setPending(current => ({ ...current, modelId: exact, ...(effort ? { thinkingId: effort } : {}) }))
    return exact
  }
  const selectThinking = (value: string) => {
    const modelId = models && runtime === 'codex' ? `${splitCodexModelId(models.currentModelId).model}[${value}]` : undefined
    setPending(current => ({ ...current, thinkingId: value,
      ...(modelId && models?.availableModels.some(model => model.modelId === modelId) ? { modelId } : {}) }))
  }
  const selectMode = (modeId: string) => setPending(current => ({ ...current, modeId }))
  const acknowledge = useCallback((key: keyof Pending, value: string | undefined, available?: string[]) => {
    setPending(current => {
      const selected = current[key]
      if (selected === undefined || selected !== value && (!available || available.includes(selected))) return current
      return { ...current, [key]: undefined,
        ...(key === 'modelId' && selected !== value ? { thinkingId: undefined } : {}) }
    })
  }, [])
  const reset = useCallback(() => setPending(current => Object.values(current).some(value => value !== undefined) ? {} : current), [])
  return { models, modes, thinking, selectModel, selectThinking, selectMode, acknowledge, reset }
}
