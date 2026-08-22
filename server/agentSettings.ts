// 에이전트 런타임별 사용자 설정 — 실행 파일·인자 오버라이드와 공급자 env(API 키·엔드포인트).
// agent-defaults(모델·권한 모드)와 달리 spawn spec 자체를 바꾸는 값이라 agentRuntimes.spec()이
// 여기 값을 섞어 내보낸다. 시크릿이므로 파일은 DATA_DIR(0o700)에 두고 브라우저 API는 마지막
// 4자만 돌려준다 — 전체 값은 절대 화면으로 돌아오지 않는다.
import path from 'node:path'
import { DATA_DIR, readJsonRecord, writeFileAtomic } from './dataDir.ts'
import { isRuntime } from './agentRuntimes.ts'

export interface AgentRuntimeSetting {
  /** 실행 파일 경로/이름 오버라이드. 없으면 등록표 기본값을 쓴다. */
  cmd?: string
  /** 등록표 기본 인자에 **덧붙이는** 추가 인자. 기본 인자를 지우려면 등록표 env를 쓴다. */
  extraArgs?: string[]
  /** 프로세스에 얹는 env — API 키·엔드포인트 같은 공급자 설정. 값은 서버에만 남는다. */
  env?: Record<string, string>
}

export class AgentSettingError extends Error {}

const SETTINGS_FILE = path.join(DATA_DIR, 'agent-settings.json')
const MAX_CMD_LEN = 500
const MAX_ARGS = 100
const MAX_ENV_ENTRIES = 20
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export function maskSecret(value: string): string {
  if (value.length <= 4) return '****'
  return `****${value.slice(-4)}`
}

function cleanCmd(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new AgentSettingError('실행 파일은 문자열이어야 합니다')
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_CMD_LEN || /[\n\r]/.test(trimmed) || trimmed.includes('\0')) {
    throw new AgentSettingError('실행 파일 값이 올바르지 않습니다')
  }
  return trimmed
}

function cleanExtraArgs(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) throw new AgentSettingError('추가 인자는 문자열 배열이어야 합니다')
  const args = value
    .map((arg) => (typeof arg === 'string' ? arg.trim() : ''))
    .filter((arg) => arg.length > 0)
  if (args.length > MAX_ARGS) throw new AgentSettingError('추가 인자가 너무 많습니다')
  return args.length > 0 ? args : undefined
}

function cleanEnv(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentSettingError('환경 변수는 객체여야 합니다')
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_ENV_ENTRIES) throw new AgentSettingError('환경 변수가 너무 많습니다')
  const env: Record<string, string> = {}
  for (const [key, raw] of entries) {
    if (!ENV_KEY_RE.test(key)) throw new AgentSettingError(`환경 변수 이름이 올바르지 않습니다: ${key}`)
    if (typeof raw !== 'string') throw new AgentSettingError(`${key} 값은 문자열이어야 합니다`)
    const trimmed = raw.trim()
    if (!trimmed) continue
    if (trimmed.length > 4000) throw new AgentSettingError(`${key} 값이 너무 깁니다`)
    env[key] = trimmed
  }
  return Object.keys(env).length > 0 ? env : undefined
}

export function normalizeAgentSetting(input: unknown): AgentRuntimeSetting {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AgentSettingError('런타임 설정 형식이 올바르지 않습니다')
  }
  const rec = input as Record<string, unknown>
  const cmd = cleanCmd(rec.cmd)
  const extraArgs = cleanExtraArgs(rec.extraArgs)
  const env = cleanEnv(rec.env)
  if (!cmd && !extraArgs && !env) throw new AgentSettingError('저장할 설정이 없습니다')
  return {
    ...(cmd ? { cmd } : {}),
    ...(extraArgs ? { extraArgs } : {}),
    ...(env ? { env } : {}),
  }
}

export function readAgentSettings(): Record<string, AgentRuntimeSetting> {
  const parsed = readJsonRecord<unknown>(SETTINGS_FILE)
  if (parsed === null) return {}
  const settings: Record<string, AgentRuntimeSetting> = {}
  for (const [runtime, value] of Object.entries(parsed)) {
    // 등록표에서 빠진 옛 런타임은 실행될 수 없으므로 무시한다.
    if (!isRuntime(runtime)) continue
    try {
      settings[runtime] = normalizeAgentSetting(value)
    } catch {
      // 깨진 항목 하나가 다른 런타임 spawn을 막지 않게 — 해당 런타임만 기본값으로 돌아간다
    }
  }
  return settings
}

export function readAgentSetting(runtime: string): AgentRuntimeSetting | null {
  if (!isRuntime(runtime)) throw new AgentSettingError('알 수 없는 에이전트 런타임입니다')
  return readAgentSettings()[runtime] ?? null
}

export function writeAgentSetting(runtime: string, input: unknown): AgentRuntimeSetting {
  if (!isRuntime(runtime)) throw new AgentSettingError('알 수 없는 에이전트 런타임입니다')
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AgentSettingError('런타임 설정 형식이 올바르지 않습니다')
  }
  // 병합 저장 — 브라우저는 시크릿 원문을 못 받아 오므로(마스킹만 전송) 건드리지 않은 env 키가
  // 빠져 있으면 기존 값을 유지해야 한다. cmd·extraArgs는 명시한 값으로 교체, 없으면 기존 유지.
  const rec = input as Record<string, unknown>
  const value = {
    cmd: cleanCmd(rec.cmd),
    extraArgs: cleanExtraArgs(rec.extraArgs),
    env: cleanEnv(rec.env),
  }
  const settings = readAgentSettings()
  const prev = settings[runtime]
  const merged: AgentRuntimeSetting = {
    cmd: value.cmd ?? prev?.cmd,
    extraArgs: value.extraArgs ?? prev?.extraArgs,
    env: { ...prev?.env, ...value.env },
  }
  // 전부 비었으면 항목 자체를 지운다 — "설정 없음"으로 되돌린 상태다
  if (!merged.cmd && !merged.extraArgs && !merged.env) {
    delete settings[runtime]
  } else {
    settings[runtime] = Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== undefined && (typeof v !== 'object' || Object.keys(v).length > 0)),
    ) as AgentRuntimeSetting
  }
  writeFileAtomic(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`)
  return settings[runtime] ?? {}
}

export function deleteAgentSetting(runtime: string): void {
  if (!isRuntime(runtime)) throw new AgentSettingError('알 수 없는 에이전트 런타임입니다')
  const settings = readAgentSettings()
  if (!settings[runtime]) return
  delete settings[runtime]
  writeFileAtomic(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`)
}

/** 브라우저로 내보내는 마스킹 뷰 — env 값은 키별 마지막 4자만. */
export function describeAgentSetting(runtime: string): {
  cmd?: string
  extraArgs?: string[]
  env?: Record<string, string>
} | null {
  const setting = readAgentSetting(runtime)
  if (!setting) return null
  return {
    ...(setting.cmd ? { cmd: setting.cmd } : {}),
    ...(setting.extraArgs ? { extraArgs: setting.extraArgs } : {}),
    ...(setting.env
      ? { env: Object.fromEntries(Object.entries(setting.env).map(([k, v]) => [k, maskSecret(v)])) }
      : {}),
  }
}
