// 에이전트 런타임 등록표 — 창과 예약 작업이 모두 이 표를 본다.
// ACP가 공통 인터페이스다. 런타임 추가는 여기 한 줄 + 클라이언트 아이콘 한 줄이면 된다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 기본 Claude Code ACP 백엔드 — 버전 고정된 로컬 설치본. `npx @latest`로 띄우지 않는다(ADR 0034). */
const DEFAULT_CLAUDE_ACP_CMD = path.resolve(here, '../node_modules/.bin/claude-agent-acp')
const DEFAULT_CODEX_ACP_CMD = path.resolve(here, '../node_modules/.bin/codex-acp')
const DEFAULT_CODEX_CLI_CMD = path.resolve(here, '../node_modules/.bin/codex')
const PRIME_ADAPTER_CMD = path.resolve(here, 'primeAdapter.ts')

/** ACP가 인증 전에 뜨지 못해도 브라우저 터미널에서 실행할 수 있는 공통 로그인 method id. */
export const RUNTIME_LOGIN_METHOD_ID = 'mew-runtime-login'

export interface SpawnSpec {
  cmd: string
  args: string[]
  env?: Record<string, string | undefined>
}

export interface RuntimeSkill {
  name: string
  description: string
  path: string
}

/** 브라우저에는 name/description만 보내고 실행 spec은 owner/manager 전용 서버 경계 안에 둔다. */
export interface RuntimeLoginSpec extends SpawnSpec {
  name: string
  description: string
  label: string
}

/** 계정 한도 조회는 대화형 CLI 안의 슬래시 명령만 지원한다. API 키·토큰은 Mew가 받거나 저장하지 않는다. */
export interface RuntimeAccountUsageSpec extends SpawnSpec {
  slashCommand: string
  label: string
}

export interface RuntimeAuthentication {
  /** ACP initialize 이전 실패까지 복구하는 런타임 고정 로그인/초기 설정 명령. */
  login: () => RuntimeLoginSpec
  /** 구형 SDK가 terminal `type`/`args`를 지우는 method는 이 GUI 터미널 하나로 치환한다. */
  replaceMethodIds?: string[]
  /** 공급자마다 다른 ACP API-key `_meta` wire shape. */
  apiKeyMeta?: (secret: string) => Record<string, unknown>
}

export interface AgentRuntime {
  id: string
  label: string
  /** ACP stdio 서버. 에이전트 창과 예약 작업이 공통으로 쓴다. */
  spec: () => SpawnSpec
  /** UI 설치 버튼이 실행하는 고정 명령. 요청 값을 인자에 섞지 않는다. */
  install?: () => SpawnSpec
  /** 설치를 되돌리는 고정 명령. 선언하지 않으면 UI가 임의 파일 삭제를 하지 않는다. */
  uninstall?: () => SpawnSpec
  /** 설치와 별개인 인증 계약. 등록된 모든 런타임이 GUI 로그인 복구 경로를 가진다. */
  auth: RuntimeAuthentication
  /** 공급자 CLI가 보장하는 비대화형 로그아웃 명령. */
  logout?: () => SpawnSpec
  /** 런타임이 스킬을 해석하는 방법. 없으면 모든 ACP 에이전트가 읽을 수 있는 일반 지시문을 쓴다. */
  skillPrompt?: (skills: RuntimeSkill[]) => string
}

function splitArgs(value: string | undefined, fallback: string[] = []): string[] {
  return value === undefined ? fallback : value.split(' ').filter(Boolean)
}

/** PATH에서 실행 파일을 찾는다. 없으면 null */
export function findExecutable(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      /* 다음 디렉터리 */
    }
  }
  return null
}

function claudeSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_CMD || process.env.MEW_AGENT_CLAUDE_CMD || DEFAULT_CLAUDE_ACP_CMD
  const args = splitArgs(process.env.MEW_AGENT_ARGS ?? process.env.MEW_AGENT_CLAUDE_ARGS)
  const env: Record<string, string | undefined> = {}
  // CLAUDE_CONFIG_DIR을 넘기면 에이전트가 mew 서버 사용자의 자격증명을 보지 않는다(2단계 준비).
  if (process.env.MEW_AGENT_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = process.env.MEW_AGENT_CONFIG_DIR
  // 어댑터가 번들한 CLI는 어댑터 버전 핀에 묶여 모델 목록이 낡는다(새 모델이 안 보인다).
  // 시스템에 설치된 claude가 있으면 그걸 쓰게 해 모델 목록이 사용자의 설치본을 따라가게 한다.
  if (!process.env.CLAUDE_CODE_EXECUTABLE) {
    const systemClaude = findExecutable('claude')
    if (systemClaude) env.CLAUDE_CODE_EXECUTABLE = systemClaude
  }
  return { cmd, args, env }
}

/** Codex — 버전 고정된 로컬 어댑터(@agentclientprotocol/codex-acp). */
function codexSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_CODEX_CMD || DEFAULT_CODEX_ACP_CMD
  // mew는 서버 쪽 브라우저가 아니라 접속한 사용자의 브라우저에서 로그인해야 한다. 일반 OAuth가
  // 서버 머신의 localhost를 열지 않게 감추고, ACP URL elicitation 기반 device-code 방법을 쓴다.
  return {
    cmd,
    args: splitArgs(process.env.MEW_AGENT_CODEX_ARGS),
    env: { NO_BROWSER: process.env.NO_BROWSER ?? '1' },
  }
}

function hermesSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_HERMES_CMD || 'hermes'
  return { cmd, args: splitArgs(process.env.MEW_AGENT_HERMES_ARGS, ['acp']) }
}

function kimiSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_KIMI_CMD || 'kimi'
  return { cmd, args: splitArgs(process.env.MEW_AGENT_KIMI_ARGS, ['acp']) }
}

function geminiSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_GEMINI_CMD || 'gemini'
  return {
    cmd,
    args: splitArgs(process.env.MEW_AGENT_GEMINI_ARGS, ['--acp']),
    env: { NO_BROWSER: process.env.NO_BROWSER ?? 'true' },
  }
}

function openclawSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_OPENCLAW_CMD || 'openclaw'
  return { cmd, args: splitArgs(process.env.MEW_AGENT_OPENCLAW_ARGS, ['acp']) }
}

function opencodeSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_OPENCODE_CMD || 'opencode'
  return { cmd, args: splitArgs(process.env.MEW_AGENT_OPENCODE_ARGS, ['acp']) }
}

/** Cursor CLI는 기본 실행 파일 이름이 `agent`다. ACP 진입점이 달라지면 env로 덮어쓴다. */
function cursorSpawnSpec(): SpawnSpec {
  const cmd = process.env.MEW_AGENT_CURSOR_CMD || 'agent'
  return {
    cmd,
    args: splitArgs(process.env.MEW_AGENT_CURSOR_ARGS, ['acp']),
    env: { NO_OPEN_BROWSER: process.env.NO_OPEN_BROWSER ?? '1' },
  }
}

function primeSpawnSpec(): SpawnSpec {
  // Prime ACP에는 session/list·load·모델·mode 계약이 없으므로, mew가 공식 CLI의 RPC를 ACP로 번역한다.
  // `MEW_AGENT_PRIME_CMD`는 예전 로컬 ACP 포크 설정이므로 의도적으로 읽지 않는다.
  return { cmd: process.execPath, args: [PRIME_ADAPTER_CMD, ...splitArgs(process.env.MEW_AGENT_PRIME_ARGS)] }
}

const login = (
  spec: SpawnSpec,
  args: string[],
  name: string,
  description: string,
  label = name,
): RuntimeLoginSpec => ({ cmd: spec.cmd, args, env: spec.env, name, description, label })

export const RUNTIMES: Record<string, AgentRuntime> = {
  claude: {
    id: 'claude', label: 'Claude Code', spec: claudeSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '--no-save', '@agentclientprotocol/claude-agent-acp@0.65.0'] }),
    logout: () => ({ cmd: findExecutable('claude') ?? 'claude', args: ['auth', 'logout'] }),
    auth: {
      login: () => {
        const spec = claudeSpawnSpec()
        return login(spec, [...spec.args, '--cli'], 'Claude Code 로그인', 'Claude Code 로그인 화면을 터미널에서 엽니다.')
      },
    },
  },
  codex: {
    id: 'codex', label: 'Codex', spec: codexSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '--no-save', '@agentclientprotocol/codex-acp@1.6.0'] }),
    logout: () => ({ cmd: DEFAULT_CODEX_CLI_CMD, args: ['logout'] }),
    auth: {
      login: () => login(
        { cmd: DEFAULT_CODEX_CLI_CMD, args: [], env: codexSpawnSpec().env },
        ['login', '--device-auth'],
        'Codex 로그인',
        '기기 코드를 이용해 ChatGPT 계정으로 로그인합니다.',
      ),
    },
  },
  hermes: {
    id: 'hermes', label: 'Hermes', spec: hermesSpawnSpec,
    install: () => ({ cmd: 'uv', args: ['tool', 'install', '--force', 'hermes-agent[acp]'] }),
    uninstall: () => ({ cmd: 'uv', args: ['tool', 'uninstall', 'hermes-agent'] }),
    auth: {
      login: () => login(hermesSpawnSpec(), ['acp', '--setup'], 'Hermes 로그인/설정', '모델 공급자와 자격증명을 설정합니다.'),
      replaceMethodIds: ['hermes-setup'],
    },
  },
  kimi: {
    id: 'kimi', label: 'Kimi Code', spec: kimiSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', '@moonshot-ai/kimi-code@latest'] }),
    uninstall: () => ({ cmd: 'npm', args: ['uninstall', '-g', '@moonshot-ai/kimi-code'] }),
    auth: {
      login: () => login(kimiSpawnSpec(), ['login'], 'Kimi Code 로그인', '기기 코드를 이용해 Kimi 계정으로 로그인합니다.'),
      replaceMethodIds: ['login'],
    },
  },
  gemini: {
    id: 'gemini', label: 'Gemini CLI', spec: geminiSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', '@google/gemini-cli@latest'] }),
    uninstall: () => ({ cmd: 'npm', args: ['uninstall', '-g', '@google/gemini-cli'] }),
    auth: {
      login: () => login(geminiSpawnSpec(), ['--skip-trust'], 'Gemini CLI 로그인/설정', 'Google 로그인 또는 인증 방식을 터미널에서 선택합니다.'),
      replaceMethodIds: ['oauth-personal', 'vertex-ai', 'gateway'],
      // Gemini ACP는 객체가 아니라 문자열을 요구한다. Codex 호환 shape를 공통 적용하면 로그인이 실패한다.
      apiKeyMeta: (secret) => ({ 'api-key': secret }),
    },
  },
  openclaw: {
    id: 'openclaw', label: 'OpenClaw', spec: openclawSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', 'openclaw@latest'] }),
    uninstall: () => ({ cmd: 'npm', args: ['uninstall', '-g', 'openclaw'] }),
    auth: {
      login: () => login(openclawSpawnSpec(), ['onboard', '--tui'], 'OpenClaw 로그인/설정', '공급자 인증과 게이트웨이를 대화형으로 설정합니다.'),
    },
  },
  opencode: {
    id: 'opencode', label: 'OpenCode', spec: opencodeSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', 'opencode-ai@latest'] }),
    uninstall: () => ({ cmd: 'npm', args: ['uninstall', '-g', 'opencode-ai'] }),
    logout: () => ({ cmd: 'opencode', args: ['auth', 'logout'] }),
    auth: {
      login: () => login(opencodeSpawnSpec(), ['auth', 'login'], 'OpenCode 로그인', '모델 공급자를 골라 로그인합니다.'),
    },
  },
  cursor: {
    id: 'cursor', label: 'Cursor CLI', spec: cursorSpawnSpec,
    install: () => ({ cmd: 'bash', args: ['-lc', 'curl https://cursor.com/install -fsS | bash'] }),
    auth: {
      login: () => login(cursorSpawnSpec(), ['login'], 'Cursor CLI 로그인', 'Cursor 계정으로 로그인합니다.'),
      replaceMethodIds: ['cursor_login'],
    },
  },
  prime: {
    id: 'prime', label: 'Prime Agent', spec: primeSpawnSpec,
    // 공식 인스톨러 — Linux·macOS 공통. 버전 있는 릴리스를 내려받아 검증 후 prime-agent 명령을 심는다.
    install: () => ({ cmd: 'sh', args: ['-lc', 'curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh'] }),
    auth: {
      // /login은 Prime Agent TUI의 슬래시 명령이다 — 터미널 팝업에서 대화형으로 공급자를 고른다.
      login: () => login({ cmd: process.env.MEW_PRIME_AGENT_EXECUTABLE || 'prime-agent', args: [] }, [], 'Prime Agent 로그인/설정', "TUI에서 /login을 입력해 공급자(Claude·ChatGPT·Copilot·API key)를 등록합니다. 설정 뒤 이 탭을 닫으면 Mew 어댑터가 연결됩니다."),
      replaceMethodIds: ['login'],
    },
  },
}

export const DEFAULT_RUNTIME = 'claude'

export function isRuntime(id: string): boolean {
  return Object.hasOwn(RUNTIMES, id)
}

export function runtimeList(): { id: string; label: string }[] {
  return Object.values(RUNTIMES).map(({ id, label }) => ({ id, label }))
}

/**
 * 저장된 런타임 설정(agentSettings.ts)을 등록표 spec에 얹는다. 모든 spawn 경로(창·예약 작업·
 * 설치 판정)가 spec() 값을 쓰므로, 설정 화면에서 바꾼 실행 파일·env가 다음 세션부터 곧바로 적용된다.
 * 파일을 못 읽어도 등록표 기본값으로 에이전트는 띄울 수 있어야 하므로 실패는 조용히 무시한다.
 */
function applySetting(base: SpawnSpec, runtime: string): SpawnSpec {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- ESM circular: agentSettings는 isRuntime만 알면 된다
    const { readAgentSetting } = require('./agentSettings.ts') as typeof import('./agentSettings.ts')
    const setting = readAgentSetting(runtime)
    if (!setting) return base
    return {
      // Prime의 cmd override는 폐기된 로컬 ACP 포크 경로다. Prime은 항상 Mew 어댑터 → 공식 CLI를 탄다.
      cmd: runtime === 'prime' ? base.cmd : setting.cmd ?? base.cmd,
      args: [...base.args, ...(setting.extraArgs ?? [])],
      env: { ...base.env, ...setting.env },
    }
  } catch {
    return base
  }
}

/** 등록표 기본값 + 저장된 사용자 설정. 모든 spawn 경로는 이 값을 쓴다. */
export function resolvedSpec(id: string): SpawnSpec | null {
  const entry = RUNTIMES[id]
  if (!entry) return null
  return applySetting(entry.spec(), id)
}

/** 요청값으로 명령을 만들지 않는다. 등록표에 박힌 로그인 spec만 돌려준다. */
export function runtimeLoginSpec(runtime: string): RuntimeLoginSpec {
  const entry = RUNTIMES[runtime]
  if (!entry) throw new Error('지원하지 않는 에이전트 런타임입니다')
  return entry.auth.login()
}

/**
 * 공급자가 CLI에서 직접 제공하는 구독 한도 화면만 연다. 비공개 세션 파일이나 인증 저장소를 읽어
 * 추측하지 않고, 없는 런타임은 명시적으로 미지원으로 남긴다.
 */
export function runtimeAccountUsageSpec(runtime: string): RuntimeAccountUsageSpec | null {
  if (runtime === 'codex') {
    return {
      cmd: DEFAULT_CODEX_CLI_CMD,
      args: ['--no-alt-screen'],
      env: codexSpawnSpec().env,
      slashCommand: '/status',
      label: 'Codex 계정 사용량',
    }
  }
  if (runtime === 'claude') {
    const spec = claudeSpawnSpec()
    const cli = process.env.CLAUDE_CODE_EXECUTABLE || spec.env?.CLAUDE_CODE_EXECUTABLE || findExecutable('claude')
    if (!cli) return null
    return { cmd: cli, args: [], env: spec.env, slashCommand: '/usage', label: 'Claude Code 계정 사용량' }
  }
  return null
}

function defaultSkillPrompt(skills: RuntimeSkill[]): string {
  const lines = skills.map((skill) => {
    const desc = skill.description ? ` — ${skill.description}` : ''
    return `- ${skill.name}${desc}\n  SKILL.md: ${skill.path}`
  })
  return [
    'Use the following local skill instructions for this request.',
    'For each selected skill, read its SKILL.md before acting and follow that workflow. These skills apply regardless of the agent runtime.',
    ...lines,
  ].join('\n')
}

export function composeRuntimePrompt(runtime: string, text: string, skills: RuntimeSkill[] = []): string {
  if (skills.length === 0) return text
  const makeSkillPrompt = RUNTIMES[runtime]?.skillPrompt ?? defaultSkillPrompt
  return `${makeSkillPrompt(skills)}\n\nUser request:\n${text}`
}
