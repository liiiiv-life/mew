// 사용자가 직접 넣는 프로젝트 아이콘 SVG의 검사.
//
// 화면에는 <img src="data:image/svg+xml,…">나 CSS 마스크로만 그린다(SvgPreview.tsx와 같은 방식) —
// 두 경로 모두 SVG 안의 스크립트도 외부 참조도 실행되지 않으므로, 인라인 삽입(innerHTML)과 달리
// "정제"까지는 필요 없다. 그래도 위험한 조각이 들어 있으면 저장 자체를 거부한다: 저장된 값은
// 나중에 다른 방식으로 렌더될 수 있고, 조용히 지우는 것보다 왜 안 받았는지 알려주는 편이 낫다.

export class SvgIconError extends Error {}

// ── 저장값 표기 ──────────────────────────────────────────────────────────────
// 클라이언트(src/utils/projectIcons.ts)와 **같은 문자열**이어야 한다 — svgIcon.test.ts가 대조한다.
/** 직접 넣은 SVG — 새로 저장하는 값은 전부 이것 */
export const SVG_PREFIX = 'svg:'
/** 예전에 "테마 색으로 칠하기"를 켜고 저장한 값 — 화면에서는 `svg:`와 똑같이 그린다 */
export const SVG_TINT_PREFIX = 'svgt:'

/** 아이콘 값은 프로젝트 목록 응답에 통째로 실려 나가므로 로고 한 장 수준으로 묶어둔다 */
export const MAX_SVG_ICON_BYTES = 16 * 1024

/** 라인 아이콘 키(`i:code-brackets`)·이모지처럼 SVG가 아닌 값의 길이 상한 */
export const MAX_SHORT_ICON_LEN = 32

const DANGEROUS: { re: RegExp; why: string }[] = [
  // 엔티티 폭탄은 <img>로 그려도 브라우저가 먼저 펼친다
  { re: /<!doctype|<!entity/i, why: 'DOCTYPE·ENTITY 선언' },
  { re: /<\s*script\b/i, why: '<script>' },
  { re: /<\s*foreignobject\b/i, why: '<foreignObject>' },
  { re: /[\s"'/]on[a-z]+\s*=/i, why: '이벤트 핸들러(on…=)' },
  { re: /javascript\s*:/i, why: 'javascript: URL' },
  { re: /(?:href|src)\s*=\s*["']?\s*(?:https?:)?\/\//i, why: '외부 URL 참조' },
  { re: /url\(\s*["']?\s*(?:https?:)?\/\//i, why: '외부 URL 참조' },
  { re: /(?:href|src)\s*=\s*["']?\s*data:(?!image\/)/i, why: 'data: URL' },
]

/**
 * 저장해도 되는 SVG인지 보고, 앞에 붙은 XML 선언·주석을 떼어낸 마크업을 돌려준다.
 * 문제가 있으면 SvgIconError — 메시지가 그대로 사용자에게 간다.
 */
export function normalizeSvgIcon(input: string): string {
  let svg = input.trim()
  // 디자인 도구가 붙이는 <?xml …?>·앞쪽 주석은 아이콘엔 필요 없다 (뒤에 여러 개 붙는 경우가 있어 반복)
  for (;;) {
    const next = svg
      .replace(/^<\?xml[^>]*\?>/i, '')
      .replace(/^<!--[\s\S]*?-->/, '')
      .trim()
    if (next === svg) break
    svg = next
  }

  if (!svg) throw new SvgIconError('SVG 코드가 비어 있습니다')
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg\s*>$/i.test(svg)) {
    throw new SvgIconError('<svg>로 시작해 </svg>로 끝나는 SVG 코드여야 합니다')
  }
  for (const { re, why } of DANGEROUS) {
    if (re.test(svg)) throw new SvgIconError(`안전하지 않은 내용이 있어 저장하지 않았습니다: ${why}`)
  }
  const bytes = Buffer.byteLength(svg, 'utf-8')
  if (bytes > MAX_SVG_ICON_BYTES) {
    throw new SvgIconError(
      `SVG가 너무 큽니다 (${Math.ceil(bytes / 1024)}KB / 최대 ${MAX_SVG_ICON_BYTES / 1024}KB)`,
    )
  }
  return svg
}

/** 직접 넣은 SVG 값이면 접두사와 마크업으로 나눈다 — 라인 아이콘·이모지 값이면 null */
export function splitSvgIcon(value: string): { prefix: string; markup: string } | null {
  for (const prefix of [SVG_TINT_PREFIX, SVG_PREFIX]) {
    if (value.startsWith(prefix)) return { prefix, markup: value.slice(prefix.length) }
  }
  return null
}

/**
 * 아이콘 값 하나를 검사해 저장할 형태로 돌려준다 — 프로젝트 아이콘과 터미널 명령어 버튼이 **같은
 * 표기**를 쓰므로(클라이언트도 IconPicker 하나를 공유한다) 검사도 여기 한 곳에서 한다.
 * 빈 문자열이면 "아이콘 없음"이라는 뜻으로 그대로 빈 문자열을 돌려준다.
 */
export function normalizeIconValue(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  // 직접 넣은 SVG는 마크업 전체가 값이라 길이 기준이 다르다
  const svg = splitSvgIcon(trimmed)
  if (svg) return svg.prefix + normalizeSvgIcon(svg.markup)
  if (trimmed.length > MAX_SHORT_ICON_LEN) {
    throw new SvgIconError('아이콘은 이모지 또는 아이콘 키처럼 짧은 문자여야 합니다')
  }
  return trimmed
}
