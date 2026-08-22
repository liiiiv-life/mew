/**
 * 창에서 고를 수 있는 에이전트 런타임 — 서버의 RUNTIMES(server/agentRuntimes.ts)와 id가 같아야 한다.
 * 목록이 양쪽에 있는 것은 **브랜드 아이콘 때문**이다(서버는 spawn 명령만 안다). 판정은 언제나 서버가 한다.
 *
 * 실제 제품 SVG 렌더링은 agentRuntimeIcons.tsx 한 곳에 있다.
 */
import {
  ClaudeCodeGlyph,
  CodexGlyph,
  CursorGlyph,
  GeminiCliGlyph,
  HermesAgentGlyph,
  KimiGlyph,
  OpenClawGlyph,
  OpenCodeGlyph,
  PrimeAgentGlyph,
} from './agentRuntimeIcons'

export const RUNTIMES = [
  { id: 'claude', label: 'Claude Code', Glyph: ClaudeCodeGlyph },
  { id: 'codex', label: 'Codex', Glyph: CodexGlyph },
  { id: 'hermes', label: 'Hermes', Glyph: HermesAgentGlyph },
  { id: 'kimi', label: 'Kimi Code', Glyph: KimiGlyph },
  { id: 'gemini', label: 'Gemini CLI', Glyph: GeminiCliGlyph },
  { id: 'openclaw', label: 'OpenClaw', Glyph: OpenClawGlyph },
  { id: 'opencode', label: 'OpenCode', Glyph: OpenCodeGlyph },
  { id: 'cursor', label: 'Cursor CLI', Glyph: CursorGlyph },
  { id: 'prime', label: 'Prime Agent', Glyph: PrimeAgentGlyph },
]

export const runtimeOf = (id: string) => RUNTIMES.find((runtime) => runtime.id === id) ?? RUNTIMES[0]
