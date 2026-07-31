import { Node, mergeAttributes } from '@tiptap/core'

// 이미지 노드의 스키마·마크다운 정의(React 없음). 클라이언트(ResizableImage, 리사이즈 노드뷰)와
// 서버 headless 협업 에디터(server/collabAgent.ts)가 "정확히 같은 스키마"를 공유하도록 노드뷰와
// 분리해 둔다 — 스키마가 어긋나면 협업 병합 시 이 노드가 재포맷돼 버린다.
export const imageNode = Node.create({
  name: 'image',
  group: 'block',
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: {
        default: null,
        parseHTML: (element) => {
          const width = Number.parseInt(element.getAttribute('width') ?? '', 10)
          return Number.isNaN(width) ? null : width
        },
        renderHTML: (attributes) => (attributes.width ? { width: attributes.width } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'img[src]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const { src, alt, title, width } = node.attrs
          if (width) {
            // 크기가 지정되면 순수 마크다운으로 표현할 수 없어 HTML img로 저장
            const altAttr = alt ? ` alt="${String(alt).replace(/"/g, '&quot;')}"` : ''
            const titleAttr = title ? ` title="${String(title).replace(/"/g, '&quot;')}"` : ''
            state.write(`<img src="${src}"${altAttr}${titleAttr} width="${width}">`)
          } else {
            const titlePart = title ? ` "${String(title).replace(/"/g, '\\"')}"` : ''
            state.write(`![${state.esc(alt ?? '')}](${src}${titlePart})`)
          }
          state.closeBlock(node)
        },
        parse: {
          // markdown-it이 HTML로 변환한 것을 parseHTML이 처리
        },
      },
    }
  },
})
