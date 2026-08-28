// 에이전트 런타임별 기본 모델·권한 모드. 에이전트 창 헤더의 저장 버튼이 현재 값을 여기 남기고,
// 새 ACP 세션은 session/new·session/load 직후 이 값을 다시 적용한다.
// 브라우저 localStorage가 아니라 <DATA_DIR>/agent-defaults.json에 두므로 브라우저·서버 재시작 뒤에도 남는다.
import path from 'node:path'
import { DATA_DIR, readJsonRecord, writeFileAtomic } from './dataDir.ts'
import { isRuntime } from './agentRuntimes.ts'

export interface AgentRuntimeDefault {
  modelId?: string
  thinkingId?: string
  modeId?: string
}

export class AgentDefaultError extends Error {}

const DEFAULTS_FILE = path.join(DATA_DIR, 'agent-defaults.json')
const MAX_ID_LEN = 200

function optionalId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new AgentDefaultError(`${label} id는 문자열이어야 합니다`)
  const id = value.trim()
  if (!id) return undefined
  if (id.length > MAX_ID_LEN) throw new AgentDefaultError(`${label} id가 너무 깁니다`)
  return id
}

export function normalizeAgentDefault(input: unknown): AgentRuntimeDefault {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AgentDefaultError('에이전트 기본값 형식이 올바르지 않습니다')
  }
  const rec = input as Record<string, unknown>
  const modelId = optionalId(rec.modelId, '모델')
  const thinkingId = optionalId(rec.thinkingId, '추론 정도')
  const modeId = optionalId(rec.modeId, '권한 모드')
  if (!modelId && !thinkingId && !modeId) throw new AgentDefaultError('저장할 모델·추론 정도·권한 모드가 없습니다')
  return {
    ...(modelId ? { modelId } : {}),
    ...(thinkingId ? { thinkingId } : {}),
    ...(modeId ? { modeId } : {}),
  }
}

export function readAgentDefaults(): Record<string, AgentRuntimeDefault> {
  const parsed = readJsonRecord<unknown>(DEFAULTS_FILE)
  if (parsed === null) return {}
  const defaults: Record<string, AgentRuntimeDefault> = {}
  for (const [runtime, value] of Object.entries(parsed)) {
    // 등록표에서 빠진 옛 런타임은 실행될 수 없으므로 읽지 않는다.
    if (!isRuntime(runtime)) continue
    defaults[runtime] = normalizeAgentDefault(value)
  }
  return defaults
}

export function readAgentDefault(runtime: string): AgentRuntimeDefault | null {
  if (!isRuntime(runtime)) throw new AgentDefaultError('알 수 없는 에이전트 런타임입니다')
  return readAgentDefaults()[runtime] ?? null
}

export function writeAgentDefault(runtime: string, input: unknown): AgentRuntimeDefault {
  if (!isRuntime(runtime)) throw new AgentDefaultError('알 수 없는 에이전트 런타임입니다')
  const value = normalizeAgentDefault(input)
  const defaults = readAgentDefaults()
  defaults[runtime] = value
  writeFileAtomic(DEFAULTS_FILE, `${JSON.stringify(defaults, null, 2)}\n`)
  return value
}
