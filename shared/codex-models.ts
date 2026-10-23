export function splitCodexModelId(modelId: string): { model: string; effort: string | null } {
  const match = /^(.*)\[([^\]]+)\]$/.exec(modelId)
  return match ? { model: match[1], effort: match[2] } : { model: modelId, effort: null }
}

/** ACP keeps exact model/effort IDs for execution; the panel selects each axis separately. */
export function panelModelState<T extends { currentModelId: string; availableModels: { modelId: string; name: string }[] }>(runtime: string, models: T | null) {
  if (runtime !== 'codex' || !models) return models
  const availableModels = new Map<string, { modelId: string; name: string }>()
  for (const item of models.availableModels) {
    const { model, effort } = splitCodexModelId(item.modelId)
    const suffix = ` (${effort})`
    const name = effort && item.name.endsWith(suffix) ? item.name.slice(0, -suffix.length) : item.name
    if (!availableModels.has(model)) availableModels.set(model, { modelId: model, name })
  }
  return { currentModelId: splitCodexModelId(models.currentModelId).model, availableModels: [...availableModels.values()] }
}
