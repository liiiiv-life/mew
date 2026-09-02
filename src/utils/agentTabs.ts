/**
 * 에이전트 창 탭 이름 규칙 — 이름은 브라우저에만 남는다(서버는 탭 id만 안다).
 *
 * 이름이 붙는 길이 둘이라 여기 모아 둔다: 대화에서 뽑은 이름(첫 질문·불러온 세션 제목)과
 * 사람이 두 번 눌러 직접 붙인 이름. 사람이 붙인 쪽이 이긴다 — 안 그러면 다음 턴에 도로 덮인다.
 */
/** runtime 없음(undefined)=ADR 0062 이전 저장값, null=새 탭의 명시적 미선택 */
export type AgentTab = {
  id: string
  label: string
  runtime?: string | null
  cwd?: string | null
  renamed?: boolean
  /** 같은 탭이 런타임·cwd를 갈아타도 각 대화로 돌아가기 위한 ACP 세션 포인터 */
  sessionIds?: Record<string, string>
  /** 에이전트셋으로 연 탭의 시작 설정. 런타임만 다시 고르면 사라진다. */
  preset?: { id: string; name: string; modelId: string; role: string }
}

function sessionSlot(runtime: string, cwd: string): string {
  return JSON.stringify([runtime, cwd])
}

export function sessionIdOf(tab: AgentTab, runtime: string, cwd: string): string | null {
  return tab.sessionIds?.[sessionSlot(runtime, cwd)] ?? null
}

/** 탭을 닫지 않은 채 감독이 유휴 종료된 뒤에도 같은 ACP 세션을 resume한다. */
export function withSessionId(
  tabs: AgentTab[],
  id: string,
  runtime: string,
  cwd: string,
  sessionId: string | null,
): AgentTab[] {
  const tab = tabs.find((item) => item.id === id)
  if (!tab) return tabs
  const slot = sessionSlot(runtime, cwd)
  const current = tab.sessionIds?.[slot] ?? null
  if (current === sessionId) return tabs
  return tabs.map((item) => {
    if (item.id !== id) return item
    const sessionIds = { ...item.sessionIds }
    if (sessionId) sessionIds[slot] = sessionId
    else delete sessionIds[slot]
    return { ...item, ...(Object.keys(sessionIds).length > 0 ? { sessionIds } : { sessionIds: undefined }) }
  })
}

/** 대화에서 뽑은 이름을 얹는다 — 사람이 직접 붙인 탭은 그대로 둔다 */
export function withAutoLabel(tabs: AgentTab[], id: string, label: string): AgentTab[] {
  const tab = tabs.find((t) => t.id === id)
  if (!tab || !label || tab.renamed || tab.label === label) return tabs
  return tabs.map((t) => (t.id === id ? { ...t, label } : t))
}

/** 사람이 붙인 이름. 빈 이름은 되돌리기가 아니라 취소다 — 대화에서 뽑은 이름은 다시 계산되지 않는다 */
export function withRename(tabs: AgentTab[], id: string, label: string): AgentTab[] {
  const next = label.trim()
  if (!next) return tabs
  return tabs.map((t) => (t.id === id ? { ...t, label: next, renamed: true } : t))
}

/** 프로젝트 멘션은 탭의 작업 대상을 드러내는 이름으로 쓴다. 같은 이름은 뒤에 번호를 붙인다. */
export function withProjectLabel(tabs: AgentTab[], id: string, project: string): AgentTab[] {
  const tab = tabs.find((item) => item.id === id)
  const name = project.trim()
  if (!tab || !name) return tabs
  const base = `[${name}]`
  const used = new Set(tabs.filter((item) => item.id !== id).map((item) => item.label))
  let label = base
  for (let number = 1; used.has(label); number += 1) label = `${base} (${number})`
  return tabs.map((item) => (item.id === id ? { ...item, label, renamed: true } : item))
}
