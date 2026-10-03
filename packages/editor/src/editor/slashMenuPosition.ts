/** Anchor and visual viewport share layout viewport coordinates. */
export function placeSlashMenu(
  anchor: { top: number; bottom: number; left: number },
  viewport: { top: number; left: number; width: number; height: number },
  contentHeight: number,
) {
  const margin = 8, gap = 6
  const minTop = viewport.top + margin
  const maxBottom = viewport.top + viewport.height - margin
  const below = Math.max(0, maxBottom - anchor.bottom - gap)
  const above = Math.max(0, anchor.top - gap - minTop)
  const desiredHeight = Math.min(288, contentHeight)
  const down = below >= desiredHeight || below >= above
  const maxHeight = Math.min(desiredHeight, down ? below : above)
  const width = Math.max(0, Math.min(256, viewport.width - margin * 2))
  return {
    top: Math.max(minTop, Math.min(down ? anchor.bottom + gap : anchor.top - gap - maxHeight, maxBottom - maxHeight)),
    left: Math.max(viewport.left + margin, Math.min(anchor.left, viewport.left + viewport.width - margin - width)),
    width,
    maxHeight,
  }
}
