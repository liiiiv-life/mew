import { Extension, InputRule } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { TextSelection, type EditorState } from '@tiptap/pm/state'

// 불렛/숫자 리스트 마커의 마크다운 단축어 — 기본 List 확장의 정규식과 동일하게 맞춘다
const BULLET_RE = /^\s*([-+*])\s$/
const ORDERED_RE = /^(\d+)\.\s$/

// 커서가 든 리스트 "한 줄"(listItem)만 반대 타입으로 바꾼다. 원래 리스트를
// [앞 항목들] · [변환된 단일 항목] · [뒤 항목들] 세 리스트로 쪼개, 이 항목만 다른 마커가 되게 한다
// (기본 wrapping 규칙은 문단을 리스트로 "감싸"기만 해서, 같은 위치에서 치면 변환이 아니라 중첩이 된다).
//
// state.tr에 스텝을 쌓으면 InputRule의 run()이 dispatch한다. 대상이 아니면 false를 돌려주고, 호출부는
// 핸들러에서 null을 반환해 이 플러그인을 건너뛰게 한다 — 그러면 기본 규칙(문단→리스트 생성, 같은
// 타입→중첩)이 이어서 처리한다.
function convertCurrentListItem(
  state: EditorState,
  markerLen: number,
  targetName: 'bulletList' | 'orderedList',
): boolean {
  const { $from } = state.selection
  let liDepth = -1
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'listItem') {
      liDepth = d
      break
    }
  }
  if (liDepth === -1) return false // 리스트 밖 → 문단을 리스트로 감싸는 기본 규칙에 맡긴다
  const listDepth = liDepth - 1
  const list = $from.node(listDepth)
  if (list.type.name !== 'bulletList' && list.type.name !== 'orderedList') return false
  const targetType = state.schema.nodes[targetName]
  if (!targetType || list.type === targetType) return false // 이미 같은 타입 → 기본(중첩) 동작에 맡긴다

  // 마커는 항목의 "첫 문단 맨 앞"에만 온다 — 항목의 나중 블록에서 친 거면 이 규칙 대상 아님
  if ($from.index(liDepth) !== 0) return false
  const li = $from.node(liDepth)
  const para = li.firstChild
  if (!para || para !== $from.parent) return false

  // 첫 문단에서 마커 글자만 잘라낸 새 문단 + 나머지 자식(중첩 리스트 등)을 그대로 이어붙인다
  const newPara = para.type.create(para.attrs, para.content.cut(markerLen), para.marks)
  let itemContent = Fragment.from(newPara)
  for (let i = 1; i < li.childCount; i++) itemContent = itemContent.addToEnd(li.child(i))
  const newItem = li.type.create(li.attrs, itemContent, li.marks)
  const targetList = targetType.create(targetName === 'orderedList' ? { start: 1 } : null, Fragment.from(newItem))

  const idx = $from.index(listDepth)
  const before: PMNode[] = []
  const after: PMNode[] = []
  list.forEach((child, _off, i) => {
    if (i < idx) before.push(child)
    else if (i > idx) after.push(child)
  })

  const parts: PMNode[] = []
  if (before.length) parts.push(list.type.create(list.attrs, Fragment.fromArray(before), list.marks))
  parts.push(targetList)
  if (after.length) {
    // 숫자 리스트를 쪼개면 뒷부분의 시작 번호가 이어지도록 보정한다 (불렛은 무의미)
    const afterAttrs =
      list.type.name === 'orderedList'
        ? { ...list.attrs, start: (list.attrs.start ?? 1) + idx + 1 }
        : list.attrs
    parts.push(list.type.create(afterAttrs, Fragment.fromArray(after), list.marks))
  }

  const listStart = $from.before(listDepth)
  const tr = state.tr
  tr.replaceWith(listStart, listStart + list.nodeSize, Fragment.fromArray(parts))

  // 마커를 지운 자리(변환된 항목의 문단 맨 앞)로 커서를 옮긴다: targetList<+1> listItem<+1> paragraph<+1>
  const targetListStart = listStart + (before.length ? parts[0].nodeSize : 0)
  tr.setSelection(TextSelection.create(tr.doc, targetListStart + 3))
  tr.scrollIntoView()
  return true
}

// 리스트 "줄" 사이의 상호 변환 — 이미 리스트 항목 안에서 `- `/`1. `를 치면 그 줄만 반대 타입으로
// 바꾼다. 기본 BulletList/OrderedList 규칙은 이 위치에서 "중첩"만 하므로, 우선순위를 높여 선점한다.
// 문단→리스트 생성, 같은 타입일 때의 중첩 등 나머지는 기본 규칙 그대로 동작한다.
export const ListConversion = Extension.create({
  name: 'listConversion',
  // 기본 BulletList/OrderedList(priority 100)의 wrapping input rule보다 먼저 실행돼 선점한다
  priority: 200,
  addInputRules() {
    return [
      new InputRule({
        find: BULLET_RE,
        // range.to - range.from = 문서에 이미 들어간 마커 글자 수(막 친 스페이스는 아직 삽입 전이라 제외)
        handler: ({ state, range }) =>
          convertCurrentListItem(state as EditorState, range.to - range.from, 'bulletList') ? undefined : null,
      }),
      new InputRule({
        find: ORDERED_RE,
        handler: ({ state, range }) =>
          convertCurrentListItem(state as EditorState, range.to - range.from, 'orderedList') ? undefined : null,
      }),
    ]
  },
})
