// 문서별 작업자(포커스) 배지 — 탭 바와 사이드바가 공유한다.
// count는 서버가 집계한 "이 문서를 포커스 중인 세션 수"(나 포함), mine은 내가 포커스 중인지.
//   파랑: 나 혼자 작업 중 · 노랑: 다른 1명 · 주황: 다른 2명 이상 · 초록: 나 + 다른 사람
export function PresenceBadge({ count, mine }: { count: number; mine: boolean }) {
  // 서버 반영이 반 박자 늦어 내 세션이 아직 count에 없을 수 있다 — 음수 방지
  const others = Math.max(0, count - (mine ? 1 : 0))
  let color: string
  if (mine && others === 0) color = 'bg-presence-mine'
  else if (mine) color = 'bg-presence-joined'
  else if (others === 1) color = 'bg-presence-other'
  else if (others >= 2) color = 'bg-presence-crowd'
  else return null

  const total = others + (mine ? 1 : 0)
  const title = mine
    ? others === 0
      ? '내가 작업 중인 문서입니다'
      : `나를 포함해 ${total}명이 작업 중입니다`
    : `${others}명이 작업 중입니다`

  return (
    <span
      className={`flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-medium text-ink-inverse ${color}`}
      title={title}
    >
      {total}
    </span>
  )
}
