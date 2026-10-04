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
          // 자동으로 재생성되는 마지막 입력용 문단은 <br/> 대신 마지막 줄바꿈 하나로 저장한다.
          // 다시 읽을 때 문단을 추가하지 않으므로 열기·삭제를 반복해도 빈 줄이 늘지 않는다.
          const implicitTail = parent?.type?.name === 'doc' && index === parent.childCount - 1
          if ((node.content.size === 0 || loneBreak) && implicitTail) {
            if (state.out.trimEnd()) state.out = state.out.replace(/\n*$/, '\n')
            return
          }
          if (node.content.size === 0 || loneBreak) state.write('<br/>')
          else state.renderInline(node)
          state.closeBlock(node)
          if (implicitTail && state.out) state.out = state.out.replace(/\n*$/, '\n')
        },
        parse: {},
      },
    }
  },
})
