/**
 * 창에서 고를 수 있는 에이전트 런타임 — 서버의 RUNTIMES(server/agentAcp.ts)와 id가 같아야 한다.
 * 목록이 양쪽에 있는 것은 **아이콘 때문**이다(서버는 spawn 명령만 안다). 판정은 언제나 서버가 한다 —
 * 여기 없는 id를 보내도 WS가 400으로 끊는다.
 *
 * 에이전트 창(AgentPanel)과 에이전트셋 창(AgentSetPanel)이 같이 쓴다.
 */

/** Claude Code — Anthropic의 방사형 표식 */
function ClaudeGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="shrink-0">
      <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />
    </svg>
  )
}

/** Codex — 육각 매듭 */
function CodexGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M12 3 4.2 7.5v9L12 21l7.8-4.5v-9Z" />
      <path d="M12 12v5M12 12l4.3-2.5" />
    </svg>
  )
}

/** Hermes — 날개 달린 투구 */
function HermesGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M7 14a5 5 0 0 1 10 0v3a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z" />
      <path d="M7 10 2 8m5 4-4 1" />
      <path d="m17 10 5-2m-5 4 4 1" />
    </svg>
  )
}

export const RUNTIMES = [
  { id: 'claude', label: 'Claude Code', Glyph: ClaudeGlyph },
  { id: 'codex', label: 'Codex', Glyph: CodexGlyph },
  { id: 'hermes', label: 'Hermes', Glyph: HermesGlyph },
]

export const runtimeOf = (id: string) => RUNTIMES.find((r) => r.id === id) ?? RUNTIMES[0]
