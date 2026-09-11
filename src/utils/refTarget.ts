// Ctrl+L 참조(`경로:줄`)를 어느 보조창에 써 줄지 고른다. 예전에는 열려 있는 창이 전부 받아 적었다 —
// 터미널에도 찍히고 에이전트 입력칸에도 붙어, 쓰지도 않을 창에 찌꺼기가 남았다.
export type RefPanel = 'agent' | 'terminal' | 'chat'

/** 고르는 순서 — 마지막으로 연 창이 닫혀 있을 때의 차선책이다 */
const FALLBACK: readonly RefPanel[] = ['agent', 'terminal', 'chat']

/**
 * 마지막으로 연 창이 아직 열려 있으면 그 창, 아니면 지금 열려 있는 창 중 하나.
 * 하나도 안 열려 있으면 null — 참조가 갈 곳이 없으니 단축키는 아무 일도 하지 않는다.
 */
export function pickRefTarget(last: RefPanel | null, open: Record<RefPanel, boolean>): RefPanel | null {
  if (last && open[last]) return last
  return FALLBACK.find((panel) => open[panel]) ?? null
}
