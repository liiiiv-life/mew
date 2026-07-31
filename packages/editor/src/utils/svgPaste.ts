// 붙여넣은 SVG 소스 텍스트(피그마 "Copy as SVG" 등)를 .svg 파일로 바꿔 다른 에셋과 똑같은
// 업로드 경로로 태우기 위한 판별·이름 짓기. 인라인 <svg>를 본문에 그대로 두면 에디터 스키마에
// raw HTML 통과 노드가 없어(imageNode·MediaNodes만 있음) 저장하는 순간 통째로 사라진다.

/** 텍스트 전체가 하나의 SVG 문서인지 — 문장 중간에 섞여 있는 <svg>는 일반 텍스트로 둔다 */
export function isSvgMarkup(text: string): boolean {
  const t = text.trim()
  // 앞에 붙을 수 있는 건 XML 선언·DOCTYPE·주석뿐, 끝은 반드시 루트 </svg>
  if (!/^(?:<svg[\s>]|<\?xml[\s?]|<!DOCTYPE\s+svg|<!--)/i.test(t)) return false
  if (!/<svg[\s>]/i.test(t)) return false
  return /<\/svg\s*>$/i.test(t)
}

/** 업로드 파일명 — <title>이 있으면 그걸 쓴다(markdownForAsset가 확장자를 뗀 이름을 alt로 삼는다) */
export function svgFileName(markup: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(markup)?.[1] ?? ''
  const slug = title
    .replace(/<[^>]*>/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return `${slug || 'svg-image'}.svg`
}
