export function captureUpdatesShortcut(openUpdates: () => void): () => void {
  const keyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !(event.ctrlKey || event.metaKey)
      || event.altKey || event.shiftKey || event.isComposing
      || event.key.toLowerCase() !== 'u') return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!event.repeat) openUpdates()
  }
  window.addEventListener('keydown', keyDown, true)
  return () => window.removeEventListener('keydown', keyDown, true)
}
