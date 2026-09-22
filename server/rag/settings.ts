import path from 'node:path'
import { DATA_DIR, readJsonFile, writeFileAtomic } from '../dataDir.ts'
import type { RagConfiguration, RagSettings } from '../../shared/rag.ts'

export function readRagSettings(directory = DATA_DIR): RagConfiguration {
  const stored = readJsonFile<unknown>(path.join(directory, 'rag-settings.json'))
  const settings = stored === null ? { enabled: true, agentGuidance: true } : parseRagSettings(stored)
  return { ...settings, environmentDisabled: process.env.MEW_RAG_ENABLED === '0' }
}

export function parseRagSettings(value: unknown): RagSettings {
  const input = value as Partial<RagSettings> | null
  if (!input || typeof input.enabled !== 'boolean' || typeof input.agentGuidance !== 'boolean') {
    throw new Error('RAG 설정의 enabled와 agentGuidance는 참/거짓이어야 합니다.')
  }
  return { enabled: input.enabled, agentGuidance: input.agentGuidance }
}

export function saveRagSettings(value: RagSettings): RagConfiguration {
  const settings = parseRagSettings(value)
  readRagSettings() // Never overwrite an unreadable configuration.
  writeFileAtomic(path.join(DATA_DIR, 'rag-settings.json'), JSON.stringify(settings, null, 2) + '\n')
  return readRagSettings()
}

export function ragEnabled(): boolean {
  const settings = readRagSettings()
  return settings.enabled && !settings.environmentDisabled
}
