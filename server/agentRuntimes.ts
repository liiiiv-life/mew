// 에이전트 런타임 등록표 — 창, 에이전트셋, 예약 작업이 모두 이 표를 본다.
// ACP가 공통 인터페이스다. 런타임 추가는 여기 한 줄 + 클라이언트 아이콘 한 줄이면 된다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 기본 Claude Code ACP 백엔드 — 버전 고정된 로컬 설치본. `npx @latest`로 띄우지 않는다(ADR 0034). */
const DEFAULT_CLAUDE_ACP_CMD = path.resolve(here, '../node_modules/.bin/claude-agent-acp')
const DEFAULT_CODEX_ACP_CMD = path.resolve(here, '../node_modules/.bin/codex-acp')

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

export interface AgentRuntime {
  id: string
  label: string
  /** ACP stdio 서버. 에이전트 창, 에이전트셋, 예약 작업이 공통으로 쓴다. */
  spec: () => SpawnSpec
  /** UI 설치 버튼이 실행하는 고정 명령. 요청 값을 인자에 섞지 않는다. */
  install?: () => SpawnSpec
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
  return { cmd, args: splitArgs(process.env.MEW_AGENT_CODEX_ARGS) }
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
  return { cmd, args: splitArgs(process.env.MEW_AGENT_GEMINI_ARGS, ['--experimental-acp']) }
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
  return { cmd, args: splitArgs(process.env.MEW_AGENT_CURSOR_ARGS, ['acp']) }
}

export const RUNTIMES: Record<string, AgentRuntime> = {
  claude: {
    id: 'claude', label: 'Claude Code', spec: claudeSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '--no-save', '@agentclientprotocol/claude-agent-acp@0.65.0'] }),
  },
  codex: {
    id: 'codex', label: 'Codex', spec: codexSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '--no-save', '@agentclientprotocol/codex-acp@1.6.0'] }),
  },
  hermes: {
    id: 'hermes', label: 'Hermes', spec: hermesSpawnSpec,
    install: () => ({ cmd: 'uv', args: ['tool', 'install', '--force', 'hermes-agent[acp]'] }),
  },
  kimi: {
    id: 'kimi', label: 'Kimi Code', spec: kimiSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', '@moonshot-ai/kimi-code@latest'] }),
  },
  gemini: {
    id: 'gemini', label: 'Gemini CLI', spec: geminiSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', '@google/gemini-cli@latest'] }),
  },
  openclaw: {
    id: 'openclaw', label: 'OpenClaw', spec: openclawSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', 'openclaw@latest'] }),
  },
  opencode: {
    id: 'opencode', label: 'OpenCode', spec: opencodeSpawnSpec,
    install: () => ({ cmd: 'npm', args: ['install', '-g', 'opencode-ai@latest'] }),
  },
  cursor: {
    id: 'cursor', label: 'Cursor CLI', spec: cursorSpawnSpec,
    install: () => ({ cmd: 'bash', args: ['-lc', 'curl https://cursor.com/install -fsS | bash'] }),
  },
}

export const DEFAULT_RUNTIME = 'claude'

export function isRuntime(id: string): boolean {
  return Object.hasOwn(RUNTIMES, id)
}

export function runtimeList(): { id: string; label: string }[] {
  return Object.values(RUNTIMES).map(({ id, label }) => ({ id, label }))
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
