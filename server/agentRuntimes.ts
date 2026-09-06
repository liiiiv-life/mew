// 에이전트 런타임 등록표 — 창과 예약 작업이 모두 이 표를 본다.
// ACP가 공통 인터페이스다. 런타임 추가는 여기 한 줄 + 클라이언트 아이콘 한 줄이면 된다.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 기본 Claude Code ACP 백엔드 — 버전 고정된 로컬 설치본. `npx @latest`로 띄우지 않는다(ADR 0034). */
const DEFAULT_CLAUDE_ACP_CMD = path.resolve(here, '../node_modules/.bin/claude-agent-acp')
const DEFAULT_CODEX_ACP_CMD = path.resolve(here, '../node_modules/.bin/codex-acp')
const DEFAULT_CODEX_CLI_CMD = path.resolve(here, '../node_modules/.bin/codex')
const PRIME_ADAPTER_CMD = path.resolve(here, 'primeAdapter.ts')
const GEMINI_OAUTH_SETTINGS_PATH = path.resolve(here, 'gemini-oauth-settings.json')

/** ACP가 인증 전에 뜨지 못해도 브라우저 터미널에서 실행할 수 있는 공통 로그인 method id. */
export const RUNTIME_LOGIN_METHOD_ID = 'mew-runtime-login'
/** Kimi Code의 글로벌(.ai) OAuth는 기본 mainland-cn(.com) 로그인과 별도 리전으로 실행한다. */
export const KIMI_GLOBAL_LOGIN_METHOD_ID = 'mew-kimi-global-login'
/** Claude Console OAuth는 기본 Claude 구독 로그인과 별도 과금 계정으로 실행한다. */
export const CLAUDE_CONSOLE_LOGIN_METHOD_ID = 'mew-claude-console-login'

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

/** 브라우저에는 id/name/description/surface만 보내고 실행 spec은 owner/manager 전용 서버 경계 안에 둔다. */
export interface RuntimeLoginSpec extends SpawnSpec {
  id: string
  name: string
  description: string
  label: string
  surface: 'browser' | 'terminal'
  verificationHosts?: string[]
  /** 브라우저 승인 뒤 CLI가 돌려받아야 하는 짧은 일회용 입력. */
  browserInput?: 'authorization-code'
  /** 명령이 TUI로 남아도 이 파일이 바뀌면 인증 완료로 본다. 경로는 브라우저에 보내지 않는다. */
  completionFile?: string
  /** 외부 CLI가 자격증명을 쓴 뒤 살아 있는 ACP에 호출해 선택한 인증 방식까지 저장한다. */
  acpMethodId?: string
}

export interface RuntimeAuthentication {
  /** ACP initialize 이전 실패까지 복구하는 런타임 고정 로그인/초기 설정 명령. */
  methods: () => RuntimeLoginSpec[]
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
  id: string,
  spec: SpawnSpec,
  args: string[],
  name: string,
  description: string,
  label = name,
  surface: RuntimeLoginSpec['surface'] = 'terminal',
  verificationHosts?: string[],
  browserInput?: RuntimeLoginSpec['browserInput'],
  completionFile?: string,
  acpMethodId?: string,
): RuntimeLoginSpec => ({ id, cmd: spec.cmd, args, env: spec.env, name, description, label, surface, verificationHosts, browserInput, completionFile, acpMethodId })

export const RUNTIMES: Record<string, AgentRuntime> = {
  claude: {
    id: 'claude', label: 'Claude Code', spec: claudeSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '--no-save', '@agentclientprotocol/claude-agent-acp@0.65.0'] }),
    logout: () => ({ cmd: findExecutable('claude') ?? 'claude', args: ['auth', 'logout'] }),
    auth: {
      methods: () => {
        const spec = claudeSpawnSpec()
        const authSpec = { ...spec, env: { ...spec.env, NO_BROWSER: process.env.NO_BROWSER ?? '1' } }
        return [
          login(
            RUNTIME_LOGIN_METHOD_ID,
            authSpec,
            [...spec.args, '--cli', 'auth', 'login', '--claudeai'],
            'Claude 구독 로그인',
            'Claude Pro·Max·Team·Enterprise 구독 계정으로 로그인합니다.',
            undefined,
            'browser',
            ['claude.com'],
            'authorization-code',
          ),
          login(
            CLAUDE_CONSOLE_LOGIN_METHOD_ID,
            authSpec,
            [...spec.args, '--cli', 'auth', 'login', '--console'],
            'Anthropic Console 로그인',
            'API 사용량이 청구되는 Anthropic Console 계정으로 로그인합니다.',
            undefined,
            'browser',
            ['platform.claude.com'],
            'authorization-code',
          ),
        ]
      },
      replaceMethodIds: ['claude-login', 'claude-ai-login', 'console-login'],
    },
  },
  codex: {
    id: 'codex', label: 'Codex', spec: codexSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '--no-save', '@agentclientprotocol/codex-acp@1.6.0'] }),
    logout: () => ({ cmd: DEFAULT_CODEX_CLI_CMD, args: ['logout'] }),
    auth: {
      methods: () => [login(
        RUNTIME_LOGIN_METHOD_ID,
        { cmd: DEFAULT_CODEX_CLI_CMD, args: [], env: codexSpawnSpec().env },
        ['login', '--device-auth'],
        'Codex 로그인',
        '기기 코드를 표시합니다. URL은 휴대폰의 일반 브라우저에서 여세요.',
        undefined,
        'browser',
        ['auth.openai.com'],
      )],
      // 같은 device-code를 ACP 안과 별도 CLI 두 곳에서 보이지 않게 공통 작업으로 치환한다.
      replaceMethodIds: ['chat-gpt-device-code'],
    },
  },
  hermes: {
    id: 'hermes', label: 'Hermes', spec: hermesSpawnSpec,
    install: () => ({ cmd: 'uv', args: ['tool', 'install', '--force', 'hermes-agent[acp]'] }),
    uninstall: () => ({ cmd: 'uv', args: ['tool', 'uninstall', 'hermes-agent'] }),
    auth: {
      methods: () => [login(RUNTIME_LOGIN_METHOD_ID, hermesSpawnSpec(), ['acp', '--setup'], 'Hermes 로그인/설정', '모델 공급자와 자격증명을 설정합니다.')],
      replaceMethodIds: ['hermes-setup'],
    },
  },
  kimi: {
    id: 'kimi', label: 'Kimi Code', spec: kimiSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', '@moonshot-ai/kimi-code@latest'] }),
    uninstall: () => ({ cmd: 'npm', args: ['uninstall', '-g', '@moonshot-ai/kimi-code'] }),
    auth: {
      methods: () => [
        login(
          RUNTIME_LOGIN_METHOD_ID,
          kimiSpawnSpec(),
          ['login'],
          'Kimi Code 로그인 (.com)',
          'Kimi.com 계정으로 기기 코드 로그인을 진행합니다.',
          undefined,
          'browser',
          ['auth.kimi.com', 'kimi.com', 'www.kimi.com'],
        ),
        login(
          KIMI_GLOBAL_LOGIN_METHOD_ID,
          kimiSpawnSpec(),
          ['login', '--region', 'global'],
          'Kimi Code 로그인 (.ai)',
          'Kimi.ai 글로벌 계정으로 기기 코드 로그인을 진행합니다.',
          undefined,
          'browser',
          ['auth.kimi.ai', 'kimi.ai', 'www.kimi.ai'],
        ),
      ],
      replaceMethodIds: ['login'],
    },
  },
  gemini: {
    id: 'gemini', label: 'Gemini CLI', spec: geminiSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', '@google/gemini-cli@latest'] }),
    uninstall: () => ({ cmd: 'npm', args: ['uninstall', '-g', '@google/gemini-cli'] }),
    auth: {
      methods: () => {
        const spec = geminiSpawnSpec()
        const geminiHome = process.env.GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini')
        return [login(
          RUNTIME_LOGIN_METHOD_ID,
          { ...spec, env: { ...spec.env, GEMINI_CLI_SYSTEM_SETTINGS_PATH: process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH ?? GEMINI_OAUTH_SETTINGS_PATH } },
          ['--skip-trust'],
          'Gemini Google 로그인',
          'Google 계정에서 승인한 뒤 표시되는 인증 코드를 입력합니다.',
          undefined,
          'browser',
          ['accounts.google.com'],
          'authorization-code',
          path.join(geminiHome, 'oauth_creds.json'),
          'oauth-personal',
        )]
      },
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
      methods: () => [login(RUNTIME_LOGIN_METHOD_ID, openclawSpawnSpec(), ['onboard', '--tui'], 'OpenClaw 로그인/설정', '공급자 인증과 게이트웨이를 대화형으로 설정합니다.')],
    },
  },
  opencode: {
    id: 'opencode', label: 'OpenCode', spec: opencodeSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', 'opencode-ai@latest'] }),
    uninstall: () => ({ cmd: 'npm', args: ['uninstall', '-g', 'opencode-ai'] }),
    logout: () => ({ cmd: 'opencode', args: ['auth', 'logout'] }),
    auth: {
      methods: () => [login(RUNTIME_LOGIN_METHOD_ID, opencodeSpawnSpec(), ['auth', 'login'], 'OpenCode 로그인', '모델 공급자를 골라 로그인합니다.')],
    },
  },
  cursor: {
    id: 'cursor', label: 'Cursor CLI', spec: cursorSpawnSpec,
    install: () => ({ cmd: 'bash', args: ['-lc', 'curl https://cursor.com/install -fsS | bash'] }),
    auth: {
      methods: () => [login(
        RUNTIME_LOGIN_METHOD_ID,
        cursorSpawnSpec(),
        ['login'],
        'Cursor CLI 로그인',
        'Cursor 계정으로 로그인합니다.',
        undefined,
        'browser',
        ['cursor.com', 'www.cursor.com'],
      )],
      replaceMethodIds: ['cursor_login'],
    },
  },
  prime: {
    id: 'prime', label: 'Prime Agent', spec: primeSpawnSpec,
    // 공식 인스톨러 — Linux·macOS 공통. 버전 있는 릴리스를 내려받아 검증 후 prime-agent 명령을 심는다.
    install: () => ({ cmd: 'sh', args: ['-lc', 'curl -fsSL https://app.primeintellect.ai/prime-agent/install.sh | sh'] }),
    auth: {
      // /login은 Prime Agent TUI의 슬래시 명령이다 — 터미널 팝업에서 대화형으로 공급자를 고른다.
      methods: () => [login(RUNTIME_LOGIN_METHOD_ID, { cmd: process.env.MEW_PRIME_AGENT_EXECUTABLE || 'prime-agent', args: [] }, [], 'Prime Agent 로그인/설정', "TUI에서 /login을 입력해 공급자(Claude·ChatGPT·Copilot·API key)를 등록합니다. 설정 뒤 이 탭을 닫으면 Mew 어댑터가 연결됩니다.")],
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
export function runtimeLoginSpec(runtime: string, methodId = RUNTIME_LOGIN_METHOD_ID): RuntimeLoginSpec {
  const entry = RUNTIMES[runtime]
  if (!entry) throw new Error('지원하지 않는 에이전트 런타임입니다')
  const method = entry.auth.methods().find((item) => item.id === methodId)
  if (!method) throw new Error('지원하지 않는 런타임 로그인 방법입니다')
  return method
}

export function isRuntimeLoginMethod(runtime: string, methodId: string): boolean {
  return RUNTIMES[runtime]?.auth.methods().some((item) => item.id === methodId) ?? false
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
