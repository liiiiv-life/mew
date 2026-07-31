import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useRef, useState } from 'react'
import { imageNode } from './imageSchema'

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

// 스키마·마크다운은 imageNode(React 없음, 서버와 공유)에 있고, 여기선 리사이즈 노드뷰만 얹는다.
export const ResizableImage = imageNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})
