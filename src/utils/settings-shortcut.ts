export function isSettingsShortcut(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
    && !event.isComposing && event.key === ','
}

export function captureSettingsShortcut(openSettings: () => void): () => void {
  const keyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !isSettingsShortcut(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!event.repeat) openSettings()
  }
  window.addEventListener('keydown', keyDown, true)
  return () => window.removeEventListener('keydown', keyDown, true)
}
