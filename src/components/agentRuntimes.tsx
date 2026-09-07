/**
 * 창에서 고를 수 있는 에이전트 런타임 — 서버의 RUNTIMES(server/agentRuntimes.ts)와 id가 같아야 한다.
 * 목록이 양쪽에 있는 것은 **브랜드 아이콘 때문**이다(서버는 spawn 명령만 안다). 판정은 언제나 서버가 한다.
 *
 * 실제 제품 SVG 렌더링은 agentRuntimeIcons.tsx 한 곳에 있다.
 */
import {
  AntigravityGlyph,
  ClaudeCodeGlyph,
  CodexGlyph,
  CursorGlyph,
  HermesAgentGlyph,
  KimiGlyph,
  OpenClawGlyph,
  OpenCodeGlyph,
  PrimeAgentGlyph,
} from './agentRuntimeIcons'

export const RUNTIMES = [
  { id: 'claude', label: 'Claude Code', surface: 'terminal' as const, Glyph: ClaudeCodeGlyph },
  { id: 'antigravity', label: 'Antigravity CLI', surface: 'terminal' as const, Glyph: AntigravityGlyph },
  { id: 'codex', label: 'Codex', surface: 'acp' as const, Glyph: CodexGlyph },
  { id: 'hermes', label: 'Hermes', surface: 'acp' as const, Glyph: HermesAgentGlyph },
  { id: 'kimi', label: 'Kimi Code', surface: 'acp' as const, Glyph: KimiGlyph },
  { id: 'openclaw', label: 'OpenClaw', surface: 'acp' as const, Glyph: OpenClawGlyph },
  { id: 'opencode', label: 'OpenCode', surface: 'acp' as const, Glyph: OpenCodeGlyph },
  { id: 'cursor', label: 'Cursor CLI', surface: 'acp' as const, Glyph: CursorGlyph },
  { id: 'prime', label: 'Prime Agent', surface: 'acp' as const, Glyph: PrimeAgentGlyph },
]

export const runtimeOf = (id: string) => RUNTIMES.find((runtime) => runtime.id === id) ?? RUNTIMES[0]
