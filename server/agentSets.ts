// 에이전트셋 — "어떤 에이전트를 · 어떤 모델로 · 어떤 역할로" 굴릴지의 묶음 하나.
// 저장소는 <DATA_DIR>/agent-sets.json 단일 원본이고, 여기 있는 것은 **정의**뿐이다
// (돌아가는 세션·작업 큐는 agentSetRunner.ts가 메모리에 들고 있다).
//
// 역할(role)은 시스템 프롬프트다. ACP에는 시스템 프롬프트 필드가 없어서 세션의 **첫 프롬프트**에
// 머리말로 붙인다(agentSetRunner.#compose) — 같은 세션이 이어지는 동안 문맥에 남는다.
//
// 라우터는 목록에 항상 있고 지울 수 없다. 역할도 고정이다 — 이 셋의 일은 "판정" 하나뿐이라,
// 역할을 손대는 순간 판정 형식이 깨지고 라우팅 전체가 조용히 망가진다. 바꿀 수 있는 것은
// 어떤 에이전트·어떤 모델로 판정할지뿐이다.
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import { isRuntime, DEFAULT_RUNTIME } from './agentAcp.ts'

export interface AgentSet {
  id: string
  name: string
  /** 시스템 프롬프트 — 이 셋이 무엇을 하는 놈인지. 라우터는 고정이라 저장값을 무시한다 */
  role: string
  /** RUNTIMES의 키(claude·codex·hermes) */
  runtime: string
  /** 빈 문자열이면 런타임 기본 모델 */
  modelId: string
}

export class AgentSetError extends Error {}

const SETS_FILE = path.join(DATA_DIR, 'agent-sets.json')

export const ROUTER_ID = 'router'
const MAX_SETS = 20
const MAX_NAME_LEN = 40
const MAX_ROLE_LEN = 4000
const MAX_MODEL_LEN = 120

/**
 * 라우터의 고정 역할. 판정만 시키고 도구는 못 쓰게 한다 — 라우터가 파일을 읽기 시작하면
 * 판정 한 번이 몇십 초가 되고, 그동안 모든 프롬프트가 라우터 뒤에 줄을 선다.
 * 후보 목록과 사용자 프롬프트는 판정할 때마다 뒤에 붙는다(agentSetRunner.#routePrompt).
 */
export const ROUTER_ROLE = [
  '너는 라우터다. 사용자 프롬프트를 읽고 아래 후보 중 그 일을 맡기에 가장 적절한 에이전트셋 하나를 고른다.',
  '',
  '규칙:',
  '- 고른 셋의 id 하나만 출력한다. 설명·인사·따옴표·마침표를 붙이지 않는다.',
  '- 파일을 읽거나 명령을 실행하지 않는다. 주어진 글만 보고 판단한다.',
  '- 마땅한 후보가 없으면 none 이라고만 출력한다.',
].join('\n')

const ROUTER_DEFAULT: AgentSet = {
  id: ROUTER_ID,
  name: '라우터',
  role: ROUTER_ROLE,
  runtime: DEFAULT_RUNTIME,
  modelId: '',
}

function normalizeSet(input: unknown): AgentSet {
  if (!input || typeof input !== 'object') throw new AgentSetError('에이전트셋 형식이 올바르지 않습니다')
  const rec = input as Record<string, unknown>

  const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : crypto.randomUUID()
  if (id !== ROUTER_ID && !/^[0-9a-f-]{8,36}$/.test(id)) throw new AgentSetError('에이전트셋 id가 올바르지 않습니다')

  const name = typeof rec.name === 'string' ? rec.name.trim() : ''
  if (!name) throw new AgentSetError('이름을 입력하세요')
  if (name.length > MAX_NAME_LEN) throw new AgentSetError(`이름은 ${MAX_NAME_LEN}자 이하여야 합니다`)

  const runtime = typeof rec.runtime === 'string' ? rec.runtime : ''
  if (!isRuntime(runtime)) throw new AgentSetError('에이전트를 고르세요')

  const modelId = typeof rec.modelId === 'string' ? rec.modelId.trim() : ''
  if (modelId.length > MAX_MODEL_LEN) throw new AgentSetError('모델 id가 너무 깁니다')

  // 라우터는 이름과 역할이 고정이다 — 클라이언트가 무엇을 보내든 여기서 되돌린다
  if (id === ROUTER_ID) return { ...ROUTER_DEFAULT, runtime, modelId }

  const role = typeof rec.role === 'string' ? rec.role.trim() : ''
  if (!role) throw new AgentSetError('역할을 입력하세요')
  if (role.length > MAX_ROLE_LEN) throw new AgentSetError(`역할은 ${MAX_ROLE_LEN}자 이하여야 합니다`)

  return { id, name, role, runtime, modelId }
}

/** 클라이언트가 보낸 목록을 검증·정규화한다. 라우터는 없으면 채워 넣고 언제나 맨 앞에 둔다 */
export function normalizeSets(input: unknown): AgentSet[] {
  if (!Array.isArray(input)) throw new AgentSetError('에이전트셋 목록이 배열이 아닙니다')
  if (input.length > MAX_SETS) throw new AgentSetError(`에이전트셋은 최대 ${MAX_SETS}개까지입니다`)

  const out: AgentSet[] = []
  const seen = new Set<string>()
  for (const item of input) {
    const set = normalizeSet(item)
    if (seen.has(set.id)) throw new AgentSetError('에이전트셋 id가 중복됩니다')
    seen.add(set.id)
    out.push(set)
  }
  // 지웠거나 처음이면 되살린다 — 라우터 없는 상태는 존재하지 않는다
  const router = out.find((s) => s.id === ROUTER_ID) ?? ROUTER_DEFAULT
  return [router, ...out.filter((s) => s.id !== ROUTER_ID)]
}

export function readSets(): AgentSet[] {
  const parsed = readJsonFile<unknown>(SETS_FILE)
  if (parsed === null) return [ROUTER_DEFAULT]
  try {
    return normalizeSets(parsed)
  } catch {
    // 저장 파일이 스키마와 어긋나면 라우터만 남긴다 — 저장 시 통째로 다시 쓰인다
    return [ROUTER_DEFAULT]
  }
}

export function writeSets(input: unknown): AgentSet[] {
  const sets = normalizeSets(input)
  writeFileAtomic(SETS_FILE, `${JSON.stringify(sets, null, 2)}\n`)
  return sets
}
