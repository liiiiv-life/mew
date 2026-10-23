import test from 'node:test'
import assert from 'node:assert/strict'
import { panelModelState } from '../../shared/codex-models.ts'

test('Codex panel groups efforts without removing meaningful model name qualifiers', () => {
  const models = { currentModelId: 'astra[high]', availableModels: [
    { modelId: 'astra[low]', name: 'Astra (low)' },
    { modelId: 'astra[high]', name: 'Astra (high)' },
    { modelId: 'special[medium]', name: 'Special (preview) (medium)' },
    { modelId: 'plain', name: 'Plain (preview)' },
  ] }
  assert.deepEqual(panelModelState('codex', models), {
    currentModelId: 'astra', availableModels: [
      { modelId: 'astra', name: 'Astra' },
      { modelId: 'special', name: 'Special (preview)' },
      { modelId: 'plain', name: 'Plain (preview)' },
    ],
  })
  assert.equal(panelModelState('claude', models), models)
  assert.equal(panelModelState('codex', null), null)
})
