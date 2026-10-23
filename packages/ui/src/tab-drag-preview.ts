/** A visual-only copy keeps the original tab in layout as a stable drop slot. */
export function createTabDragPreview(source: HTMLElement, startX: number, startY: number) {
  const box = source.getBoundingClientRect()
  const preview = source.cloneNode(true) as HTMLElement
  const style = getComputedStyle(source)
  for (const element of [preview, ...preview.querySelectorAll('*')]) {
    for (const attribute of ['id', 'title', 'data-tip', 'role', 'tabindex', 'aria-selected', 'aria-current']) element.removeAttribute(attribute)
  }
  preview.setAttribute('aria-hidden', 'true')
  preview.inert = true
  preview.dataset.tabDragPreview = ''
  Object.assign(preview.style, {
    position: 'fixed', left: '0', top: '0', width: `${box.width}px`, height: `${box.height}px`,
    minWidth: '0', maxWidth: 'none', margin: '0', boxSizing: 'border-box',
    pointerEvents: 'none', zIndex: '1100', opacity: '1',
    font: style.font, color: style.color, background: 'var(--color-surface-raised)',
    borderRadius: '6px', boxShadow: '0 4px 12px rgb(0 0 0 / 20%)',
    transition: 'none', animation: 'none', cursor: 'grabbing',
  })
  // A portal-like body host avoids clipping in the tab strip's scroll container.
  document.body.append(preview)
  source.setAttribute('data-tab-drag-placeholder', '')
  const move = (x: number, y: number) => {
    preview.style.transform = `translate3d(${box.left + x - startX}px, ${Math.max(0, box.top + y - startY - 8)}px, 0)`
  }
  move(startX, startY)
  return { move, remove: () => { preview.remove(); source.removeAttribute('data-tab-drag-placeholder') } }
}
