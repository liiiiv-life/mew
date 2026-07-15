import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useRef, useState } from 'react'

const MIN_WIDTH = 80

function ImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [liveWidth, setLiveWidth] = useState<number | null>(null)
  const width = liveWidth ?? (node.attrs.width as number | null)

  function startResize(e: React.MouseEvent, dir: 1 | -1) {
    if (!editor.isEditable) return
    e.preventDefault()
    e.stopPropagation()
    const img = imgRef.current
    if (!img) return
    const startX = e.clientX
    const startWidth = img.offsetWidth
    const widthAt = (ev: MouseEvent) => Math.max(MIN_WIDTH, Math.round(startWidth + dir * (ev.clientX - startX)))
    const onMove = (ev: MouseEvent) => setLiveWidth(widthAt(ev))
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setLiveWidth(null)
      updateAttributes({ width: widthAt(ev) })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleClass =
    'absolute top-1/2 h-12 max-h-[50%] w-1.5 -translate-y-1/2 cursor-col-resize rounded-full bg-surface-inverse/70 opacity-0 transition-opacity group-hover:opacity-100'

  return (
    <NodeViewWrapper className="group relative my-2 w-fit max-w-full" data-drag-handle>
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt ?? ''}
        title={node.attrs.title ?? undefined}
        className={`block max-w-full rounded-md ${selected ? 'ring-2 ring-accent' : ''}`}
        style={width ? { width, height: 'auto' } : { height: '40vh', width: 'auto', objectFit: 'contain' }}
        onDoubleClick={() => editor.isEditable && updateAttributes({ width: null })}
        draggable={false}
      />
      {editor.isEditable && (
        <>
          <div className={`${handleClass} left-1`} onMouseDown={(e) => startResize(e, -1)} />
          <div className={`${handleClass} right-1`} onMouseDown={(e) => startResize(e, 1)} />
        </>
      )}
    </NodeViewWrapper>
  )
}

export const ResizableImage = Node.create({
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

  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
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
