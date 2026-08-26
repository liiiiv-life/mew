import Paragraph from '@tiptap/extension-paragraph'

/**
 * 핫뷰에서 만든 빈 문단은 일반 Markdown 빈 줄과 구분해 `<br/>`로 보존한다.
 * plain 뷰에서 다시 읽어도 HTML 줄바꿈으로 남아, 빈 문단이 자동으로 합쳐지지 않는다.
 */
export const EmptyParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any, parent: any, index: number) {
          const loneBreak = node.childCount === 1 && node.firstChild?.type.name === 'hardBreak'
          // ProseMirror가 문서 끝에 보장하는 빈 문단은 실제 "빈 줄"이 아니라 편집 시작점이다.
          // 이것까지 저장하면 문서를 열기만 해도 매번 <br/>가 덧붙으므로 제외한다.
          const implicitTail = parent?.type?.name === 'doc' && index === parent.childCount - 1
          if ((node.content.size === 0 || loneBreak) && !implicitTail) state.write('<br/>')
          else state.renderInline(node)
          state.closeBlock(node)
        },
        parse: {},
      },
    }
  },
})
