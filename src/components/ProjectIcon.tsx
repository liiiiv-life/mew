import { ICON_PREFIX, lookupIcon, splitSvgIcon, svgDataUrl } from '../utils/projectIcons'

/** 저장된 아이콘 값을 그린다 — `i:`로 시작하면 라인 아이콘, `svg:`/`svgt:`면 직접 넣은 SVG, 아니면 이모지 문자 */
export function ProjectIcon({ icon, size }: { icon: string; size: number }) {
  const svg = splitSvgIcon(icon)
  if (svg) return <CustomSvgIcon markup={svg.markup} size={size} />

  const Icon = lookupIcon(icon)
  if (Icon) return <Icon width={size} height={size} strokeWidth={1.5} />
  // 모르는 키(목록에서 빠진 아이콘)까지 문자로 노출하지는 않는다
  if (icon.startsWith(ICON_PREFIX)) return null
  return (
    <span className="leading-none" style={{ fontSize: size }}>
      {icon}
    </span>
  )
}

/**
 * 직접 넣은 SVG는 CSS 마스크로만 그린다 — SVG 안의 스크립트도 외부 참조도 실행되지 않는 렌더
 * 경로다(인라인 삽입과 다른 점, SvgPreview.tsx와 같은 이유).
 * 모양만 떠서 currentColor로 칠하므로 **SVG가 들고 있는 색은 언제나 버린다** — 로고마다 흰색·
 * 미색이 제각각이면 라인 아이콘과 나란히 선 탭 줄이 얼룩덜룩해지고, 단색 아이콘은 밝은·어두운
 * 테마 한쪽에서 묻힌다. 색을 살리는 선택지는 두지 않는다.
 */
function CustomSvgIcon({ markup, size }: { markup: string; size: number }) {
  const url = svgDataUrl(markup)
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 bg-current"
      style={{
        width: size,
        height: size,
        maskImage: `url("${url}")`,
        WebkitMaskImage: `url("${url}")`,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}
