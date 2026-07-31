const DOT = 5 // px — 점 지름
const BOX = 16 // px — 기존 카운트 배지와 같은 자리 크기(h-4 w-4)
const RADIUS = 5 // px — 3명 이상일 때 정n각형 반지름

function Dot({ color }: { color: string }) {
  return <span className="rounded-full" style={{ width: DOT, height: DOT, background: color }} />
}

// 사이드바·탭바에서 문서별로 지금 협업 중인 사람들의 커서 색을 점으로 보여준다 — 숫자 대신 색 자체로
// "누가" 있는지 바로 알아볼 수 있게 하는 것이 목적이라 배열 순서는 의미 없다.
// 1명: 점 하나 · 2명: 가로 나열 · 3명 이상: 맨 위 꼭짓점부터 시계방향으로 도는 정n각형 배치.
export function PresenceDots({ colors }: { colors: string[] }) {
  if (colors.length === 0) return null

  const title = `${colors.length}명이 작업 중입니다`

  if (colors.length === 1) {
    return (
      <span className="flex shrink-0 items-center justify-center" style={{ width: BOX, height: BOX }} title={title}>
        <Dot color={colors[0]} />
      </span>
    )
  }

  if (colors.length === 2) {
    return (
      <span
        className="flex shrink-0 items-center justify-center gap-1"
        style={{ width: BOX, height: BOX }}
        title={title}
      >
        {colors.map((color, i) => (
          <Dot key={i} color={color} />
        ))}
      </span>
    )
  }

  return (
    <span className="relative shrink-0" style={{ width: BOX, height: BOX }} title={title}>
      {colors.map((color, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / colors.length
        const x = BOX / 2 + Math.cos(angle) * RADIUS
        const y = BOX / 2 + Math.sin(angle) * RADIUS
        return (
          <span
            key={i}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ width: DOT, height: DOT, left: x, top: y, background: color }}
          />
        )
      })}
    </span>
  )
}
