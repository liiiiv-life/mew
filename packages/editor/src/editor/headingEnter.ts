import { Extension, type Editor } from '@tiptap/core'

// 제목 중간에서 Enter를 치면 뒷부분은 본문(문단)이 된다. ProseMirror 기본 splitBlock은 줄 끝에서만
// 기본 블록(문단)으로 쪼개고 중간에서는 같은 노드 타입을 이어받아, `# a b`의 b 앞에서 Enter를 치면
// 제목이 둘로 갈라진다. 제목 맨 앞에서는 위에 빈 줄만 생기는 기본 동작이 맞으므로 건드리지 않는다.
export function splitHeadingIntoParagraph(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection
  if ($from.parent.type.name !== 'heading') return false
  if (empty && $from.parentOffset === 0) return false
  return editor
    .chain()
    .splitBlock()
    // 줄 끝에서 쪼갰으면 뒷블록이 이미 문단이고 setNode는 false를 준다 — 그때도 "처리했다"를 돌려줘야
    // 기본 Enter(splitBlock)가 이어서 한 번 더 쪼개지 않는다
    .command(({ state, commands }) => state.selection.$from.parent.type.name === 'paragraph' || commands.setNode('paragraph'))
    .run()
}

export const HeadingEnter = Extension.create({
  name: 'headingEnter',
  // 기본 keymap(priority 100)의 Enter(splitBlock)보다 먼저 잡아야 선점된다
  priority: 200,
  addKeyboardShortcuts() {
    return { Enter: () => splitHeadingIntoParagraph(this.editor) }
  },
})
