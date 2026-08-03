import ListItem from '@tiptap/extension-list-item'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'

// 리스트 항목의 첫 자식으로 문단 대신 리스트를 허용한다. 기본 스키마(`paragraph block*`)에서는
// "자기 줄이 없는 부모 항목"을 만들 수 없어서, 앞에 형제가 없는 첫 항목은 아예 들여쓸 수 없다.
// 마크다운 왕복도 이 스키마여야 성립한다 — `- - b`(부모 마커 + 들여쓴 항목)는 markdown-it이
// 중첩으로 읽어 주는데, 문단이 필수면 그 HTML을 리스트 항목 안에 넣지 못해 두 리스트로 풀려 버린다.
// (`  - b`처럼 부모 마커 없이 저장하면 마크다운 규칙상 다시 최상위 항목이 되어 들여쓰기가 사라진다.)
// 클라이언트(Editor.tsx)와 서버(serverExtensions.ts)가 반드시 같은 스키마를 써야 하므로 여기서 한 번만 정의한다.
export const IndentableListItem = ListItem.extend({ content: '(paragraph|bulletList|orderedList) block*' })

function isList(node: PMNode): boolean {
  return node.type.name === 'bulletList' || node.type.name === 'orderedList'
}

// 리스트의 "첫 항목" Tab 들여쓰기. sinkListItem은 바로 앞 형제 항목 안으로 현재 항목을 밀어 넣는
// 방식이라 앞 형제가 없는 첫 항목에서는 아무 일도 일어나지 않는다 — 그래서 자기 줄이 없는 부모
// 항목을 새로 만들고 그 안의 중첩 리스트로 현재 항목을 옮긴다 (마크다운으로는 `- - b`).
export function sinkFirstListItemTransaction(state: EditorState): Transaction | null {
  const { $from } = state.selection
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name !== 'listItem') continue
    const list = $from.node(d - 1)
    if (!isList(list)) return null
    if ($from.index(d - 1) !== 0) return null // 앞 형제 항목이 있으면 기본 sinkListItem이 처리한다

    const li = $from.node(d)
    const inner = list.type.create(list.attrs, Fragment.from(li))
    const wrapper = li.type.createAndFill(li.attrs, Fragment.from(inner))
    if (!wrapper) return null

    const oldLiStart = $from.before(d)
    const tr = state.tr
    tr.replaceWith(oldLiStart, $from.after(d), wrapper)
    // 커서는 옮겨진 항목 안 같은 자리로. 스키마가 문단을 앞에 채워 넣었을 수도 있으니(createAndFill)
    // 중첩 리스트가 실제로 놓인 자리를 찾아 [부모 항목 열기 + 그 앞 내용 + 리스트 열기]만큼 민다.
    let innerOffset: number | null = null
    wrapper.forEach((child, offset) => {
      if (innerOffset === null && child.eq(inner)) innerOffset = offset
    })
    if (innerOffset === null) return null
    const pos = $from.pos + 1 + innerOffset + 1
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(Math.max(pos, 1), tr.doc.content.size))))
    tr.scrollIntoView()
    return tr
  }
  return null
}

// 위 들여쓰기의 반대 — 자기 줄이 없는 부모 항목 안에서 Shift+Tab. 기본 liftListItem은 부모 항목이
// 빈 껍데기로 남는 걸 스키마가 허용하지 않아 실패하므로(그러면 들여쓴 걸 되돌릴 방법이 없다),
// 부모 항목을 [앞 항목들] · [나온 항목] · [뒤 항목들]로 쪼개 현재 항목만 바깥 리스트로 꺼낸다.
export function liftFirstListItemTransaction(state: EditorState): Transaction | null {
  const { $from } = state.selection
  for (let d = $from.depth; d >= 2; d--) {
    if ($from.node(d).type.name !== 'listItem') continue
    const list = $from.node(d - 1)
    const wrapper = $from.node(d - 2)
    // 자기 줄(문단)이 있는 평범한 부모 항목이면 기본 liftListItem이 할 일이다
    if (!isList(list) || wrapper.type.name !== 'listItem' || wrapper.childCount !== 1) return null

    const idx = $from.index(d - 1)
    const before: PMNode[] = []
    const after: PMNode[] = []
    list.forEach((child, _offset, i) => {
      if (i < idx) before.push(child)
      else if (i > idx) after.push(child)
    })
    const rewrap = (items: PMNode[]) =>
      wrapper.type.create(wrapper.attrs, Fragment.from(list.type.create(list.attrs, Fragment.fromArray(items))))
    const parts: PMNode[] = []
    if (before.length) parts.push(rewrap(before))
    parts.push($from.node(d))
    if (after.length) parts.push(rewrap(after))

    const wrapperStart = $from.before(d - 2)
    const tr = state.tr
    tr.replaceWith(wrapperStart, $from.after(d - 2), Fragment.fromArray(parts))
    // 커서는 밖으로 나온 항목 안 같은 자리로 — 항목이 옮겨간 거리만큼 그대로 옮긴다
    const newLiStart = wrapperStart + (before.length ? parts[0].nodeSize : 0)
    const pos = $from.pos + (newLiStart - $from.before(d))
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(Math.max(pos, 1), tr.doc.content.size))))
    tr.scrollIntoView()
    return tr
  }
  return null
}
