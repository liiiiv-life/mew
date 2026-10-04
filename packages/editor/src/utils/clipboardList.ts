import type { Fragment } from '@tiptap/pm/model'

// 중첩 리스트 중간을 잘라낸 복사 slice는 열린(open) 조상 래퍼 — bulletList[listItem[bulletList[...]]] —
// 를 그대로 담고 있어, 그걸 md로 직렬화하면 조상 리스트 마커까지 겹쳐 "- - - 항목"처럼 나온다.
// 단일 자식으로만 이어지는 열린 리스트 래퍼를 벗겨 실제 선택한 항목들의 층에서 직렬화하게 한다.
// 항목이 여럿인 리스트를 만나면 멈춘다 — 그 층의 "- " 마커는 살아야 한다.
export function unwrapOpenListWrappers(content: Fragment, openStart: number, openEnd: number): Fragment {
  while (openStart > 0 && openEnd > 0 && content.childCount === 1) {
    const child = content.firstChild!
    const name = child.type.name
    if (name === 'bulletList' || name === 'orderedList' || name === 'taskList') {
      if (child.childCount > 1) break
    } else if (name !== 'listItem' && name !== 'taskItem') {
      break
    }
    content = child.content
    openStart--
    openEnd--
  }
  return content
}
