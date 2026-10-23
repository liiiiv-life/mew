import type { Fragment, Node as PMNode } from '@tiptap/pm/model'

/**
 * 에디터 문서 위치(pos) → md 본문 줄 번호(1부터). 커서 앞까지 자른 문서를 그대로 직렬화하면
 * 전체 직렬화의 접두어가 된다(블록 사이 빈 줄 포함) — 그 개행 수 + 1이 곧 줄 번호다.
 * frontmatter는 에디터 문서 밖이므로 호출 쪽에서 그 줄 수를 더한다.
 */
export function sourceLineOfPos(doc: PMNode, serialize: (content: Fragment) => string, pos: number): number {
  const prefix = serialize(doc.cut(0, pos).content)
  return (prefix.match(/\n/g)?.length ?? 0) + 1
}
