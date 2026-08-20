/**
 * 에이전트 창 탭 이름 규칙 — 이름은 브라우저에만 남는다(서버는 탭 id만 안다).
 *
 * 이름이 붙는 길이 둘이라 여기 모아 둔다: 대화에서 뽑은 이름(첫 질문·불러온 세션 제목)과
 * 사람이 두 번 눌러 직접 붙인 이름. 사람이 붙인 쪽이 이긴다 — 안 그러면 다음 턴에 도로 덮인다.
 */
/** runtime 없음(undefined)=ADR 0062 이전 저장값, null=새 탭의 명시적 미선택 */
export type AgentTab = { id: string; label: string; runtime?: string | null; renamed?: boolean }

/** 대화에서 뽑은 이름을 얹는다 — 사람이 직접 붙인 탭은 그대로 둔다 */
export function withAutoLabel(tabs: AgentTab[], id: string, label: string): AgentTab[] {
  const tab = tabs.find((t) => t.id === id)
  if (!tab || tab.renamed || tab.label === label) return tabs
  return tabs.map((t) => (t.id === id ? { ...t, label } : t))
}

/** 사람이 붙인 이름. 빈 이름은 되돌리기가 아니라 취소다 — 대화에서 뽑은 이름은 다시 계산되지 않는다 */
export function withRename(tabs: AgentTab[], id: string, label: string): AgentTab[] {
  const next = label.trim()
  if (!next) return tabs
  return tabs.map((t) => (t.id === id ? { ...t, label: next, renamed: true } : t))
}
