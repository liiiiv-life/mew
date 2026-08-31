// 에이전트셋 — 새 에이전트 탭을 시작할 때 고르는 런타임·모델·역할 프리셋.
// 실행 상태나 큐를 들지 않는다. 역할은 탭 ACP 세션의 첫 프롬프트에 시스템 지시로 한 번 붙는다.
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import { isRuntime } from './agentAcp.ts'

export interface AgentSet {
  id: string
  name: string
  /** 시스템 프롬프트 — 이 셋으로 시작한 탭의 첫 프롬프트에 붙는다 */
  role: string
  /** RUNTIMES의 키(claude·codex·hermes) */
  runtime: string
  /** 빈 문자열이면 런타임 기본 모델 */
  modelId: string
}

export class AgentSetError extends Error {}

const SETS_FILE = path.join(DATA_DIR, 'agent-sets.json')

const MAX_SETS = 20
const MAX_NAME_LEN = 40
const MAX_ROLE_LEN = 4000
const MAX_MODEL_LEN = 120

function normalizeSet(input: unknown): AgentSet {
  if (!input || typeof input !== 'object') throw new AgentSetError('에이전트셋 형식이 올바르지 않습니다')
  const rec = input as Record<string, unknown>

  const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : crypto.randomUUID()
  if (!/^[0-9a-f-]{8,36}$/.test(id)) throw new AgentSetError('에이전트셋 id가 올바르지 않습니다')

  const name = typeof rec.name === 'string' ? rec.name.trim() : ''
  if (!name) throw new AgentSetError('이름을 입력하세요')
  if (name.length > MAX_NAME_LEN) throw new AgentSetError(`이름은 ${MAX_NAME_LEN}자 이하여야 합니다`)

  const runtime = typeof rec.runtime === 'string' ? rec.runtime : ''
  if (!isRuntime(runtime)) throw new AgentSetError('에이전트를 고르세요')

  const modelId = typeof rec.modelId === 'string' ? rec.modelId.trim() : ''
  if (modelId.length > MAX_MODEL_LEN) throw new AgentSetError('모델 id가 너무 깁니다')

  const role = typeof rec.role === 'string' ? rec.role.trim() : ''
  if (!role) throw new AgentSetError('역할을 입력하세요')
  if (role.length > MAX_ROLE_LEN) throw new AgentSetError(`역할은 ${MAX_ROLE_LEN}자 이하여야 합니다`)

  return { id, name, role, runtime, modelId }
}

/** 클라이언트가 보낸 프리셋 목록을 검증·정규화한다. 이전 라우터 저장값은 자동으로 버린다. */
export function normalizeSets(input: unknown): AgentSet[] {
  if (!Array.isArray(input)) throw new AgentSetError('에이전트셋 목록이 배열이 아닙니다')
  if (input.length > MAX_SETS) throw new AgentSetError(`에이전트셋은 최대 ${MAX_SETS}개까지입니다`)

  const out: AgentSet[] = []
  const names = new Set<string>()
  const seen = new Set<string>()
  for (const item of input) {
    if (item && typeof item === 'object' && (item as { id?: unknown }).id === 'router') continue
    const set = normalizeSet(item)
    if (seen.has(set.id)) throw new AgentSetError('에이전트셋 id가 중복됩니다')
    if (names.has(set.name)) throw new AgentSetError('에이전트셋 이름이 중복됩니다')
    seen.add(set.id)
    names.add(set.name)
    out.push(set)
  }
  return out
}

export function readSets(): AgentSet[] {
  const parsed = readJsonFile<unknown>(SETS_FILE)
  if (parsed === null) return []
  try {
    return normalizeSets(parsed)
  } catch {
    return []
  }
}

export function writeSets(input: unknown): AgentSet[] {
  const sets = normalizeSets(input)
  writeFileAtomic(SETS_FILE, `${JSON.stringify(sets, null, 2)}\n`)
  return sets
}
