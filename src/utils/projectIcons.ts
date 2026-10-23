import { lazy, type ComponentProps, type ComponentType } from 'react'
import { Book, Code, Folder, Github, Notes, Page, Terminal } from 'iconoir-react'
import { PROJECT_ICON_GROUPS } from './project-icon-definitions.ts'

export type IconComponent = ComponentType<ComponentProps<typeof Book>>

/** 저장값에 붙는 접두사 — 이 접두사가 없으면 예전처럼 이모지 문자열로 본다 */
export const ICON_PREFIX = 'i:'

const ICON_KEYS = new Set(PROJECT_ICON_GROUPS.flatMap(group => Object.keys(group.icons)))
const COMMON_ICONS: Record<string, IconComponent> = { book: Book, code: Code, folder: Folder, github: Github, notes: Notes, page: Page, terminal: Terminal }
const lazyIcons = new Map<string, IconComponent>()
let catalogPromise: Promise<typeof import('./project-icon-catalog.ts')> | undefined

/** 알려진 키는 동기적으로 컴포넌트를 돌려주며, 드문 아이콘의 실제 모양은 렌더할 때 로드한다. */
export function lookupIcon(icon: string): IconComponent | undefined {
  if (!icon.startsWith(ICON_PREFIX)) return undefined
  const key = icon.slice(ICON_PREFIX.length)
  if (!ICON_KEYS.has(key)) return undefined
  const common = COMMON_ICONS[key]
  if (common) return common
  let Icon = lazyIcons.get(key)
  if (!Icon) {
    Icon = lazy(() => (catalogPromise ??= import('./project-icon-catalog.ts'))
      .then(catalog => ({ default: catalog.lookupCatalogIcon(key) }))
      .catch(() => ({ default: () => null })))
    lazyIcons.set(key, Icon)
  }
  return Icon
}

// ── 직접 넣은 SVG ────────────────────────────────────────────────────────────
// 목록에 없는 아이콘(회사 로고 등)은 SVG 코드를 그대로 값에 담는다. 검사·정리는 저장할 때
// 서버(server/svgIcon.ts)가 하고, 접두사 문자열은 그쪽과 같아야 한다(svgIcon.test.ts가 대조).
// **어느 접두사로 저장돼 있든 SVG 자체의 색은 버리고** 라인 아이콘과 같은 테마 색으로 그린다
// (ProjectIcon.tsx) — 로고마다 흰색·미색이 제각각이면 탭 줄이 얼룩덜룩해지기 때문이다.
/** 직접 넣은 SVG — 새로 저장하는 값은 전부 이것 */
export const SVG_PREFIX = 'svg:'
/** 예전에 "테마 색으로 칠하기"를 켜고 저장한 값 — 지금은 `svg:`와 똑같이 그린다 */
export const SVG_TINT_PREFIX = 'svgt:'

/** 직접 넣은 SVG 값이면 접두사를 떼어낸다 — 라인 아이콘·이모지 값이면 null */
export function splitSvgIcon(icon: string): { markup: string } | null {
  for (const prefix of [SVG_TINT_PREFIX, SVG_PREFIX]) {
    if (icon.startsWith(prefix)) return { markup: icon.slice(prefix.length) }
  }
  return null
}

export function svgIconValue(markup: string): string {
  return SVG_PREFIX + markup
}

/** <img src>·CSS 마스크에 그대로 넣을 수 있는 데이터 URL (따옴표까지 이스케이프된다) */
export function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`
}

/**
 * 화면에 실제로 뭔가 그려지는 값인지 — 목록에서 빠진 `i:{키}`는 아무것도 그리지 않으므로
 * (ProjectIcon이 null을 반환한다) 이름을 감춘 자리에서는 대체 표시가 필요하다.
 */
export function hasIcon(icon: string | null | undefined): boolean {
  if (!icon) return false
  const svg = splitSvgIcon(icon)
  if (svg) return svg.markup.trim().length > 0
  return icon.startsWith(ICON_PREFIX) ? ICON_KEYS.has(icon.slice(ICON_PREFIX.length)) : true
}

export function iconValue(key: string): string {
  return ICON_PREFIX + key
}
