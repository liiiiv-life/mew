// 커서가 있는 "줄"에 클래스를 붙이는 장식 플러그인 — 왼쪽 거터의 줄 번호(editor.css의 counter)를
// 그 줄만 밝게 하는 데 쓴다. 번호를 그리는 대상과 **정확히 같은 노드**를 골라야 한다:
// 최상위 블록 하나가 한 줄이고, 리스트 안에서는 항목(listItem)이 한 줄이다.
import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const LINE_FOCUS_CLASS = 'mew-line--focus'

/**
 * 커서가 있는 줄 노드의 문서 위치. 리스트 안이면 가장 안쪽 항목, 아니면 최상위 블록이다.
 * 문서가 비었거나(깊이 0) 줄을 못 고르면 -1.
 */
export function focusedLinePos(state: EditorState): number {
  const $head = state.selection.$head
  // 손잡이 클릭처럼 블록 자체가 선택된 경우 — $head는 그 블록 **뒤**(깊이 0)를 가리키므로 from을 쓴다
  if ($head.depth < 1) return state.selection instanceof NodeSelection ? state.selection.from : -1
  // 가장 안쪽 항목이 그 줄이다 — 중첩 리스트에서 바깥 항목까지 밝아지면 안 된다
  for (let depth = $head.depth; depth >= 1; depth--)
    if ($head.node(depth).type.name === 'listItem') return $head.before(depth)
  return $head.before(1)
}

/**
 * 그 자리의 노드가 리스트 항목이면 중첩 깊이(맨 바깥이 1), 아니면 0.
 * 항목은 한 단마다 24px 들여쓰이므로, 거터의 줄 번호와 그 위에 포개지는 투명 손잡이를
 * 이 값만큼 왼쪽으로 되돌려 다른 줄과 같은 세로줄에 세운다 (editor.css의 li::before와 짝).
 */
export function listLevel(doc: PMNode, pos: number): number {
  if (pos < 0 || pos > doc.content.size) return 0
  if (doc.nodeAt(pos)?.type.name !== 'listItem') return 0
  const $pos = doc.resolve(pos)
  let level = 1
  for (let depth = 1; depth <= $pos.depth; depth++) if ($pos.node(depth).type.name === 'listItem') level++
  return level
}

export const LineFocus = Extension.create({
  name: 'lineFocus',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('lineFocus'),
        props: {
          decorations(state) {
            const pos = focusedLinePos(state)
            if (pos < 0) return null
            const node = state.doc.nodeAt(pos)
            if (!node) return null
            return DecorationSet.create(state.doc, [
              Decoration.node(pos, pos + node.nodeSize, { class: LINE_FOCUS_CLASS }),
            ])
          },
        },
      }),
    ]
  },
})
