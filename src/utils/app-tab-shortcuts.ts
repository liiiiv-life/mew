import { closeFocusedTab, getBinding, matchesShortcut, openFocusedTab } from '@mew/shortcuts'

export function appTabShortcut(event: KeyboardEvent): 'close' | 'file' | 'folder' | null {
  const primary = (event.ctrlKey || event.metaKey) && !event.altKey
  const code = event.code || `Key${event.key.toUpperCase()}`
  if ((primary && code === 'KeyW') || matchesShortcut(event, getBinding('closeTab')) || matchesShortcut(event, getBinding('closeTabAlt'))) return 'close'
  if ((primary && event.shiftKey && code === 'KeyN') || matchesShortcut(event, getBinding('treeNewFolderAlt'))) return 'folder'
  if ((primary && !event.shiftKey && (code === 'KeyN' || code === 'KeyT'))
    || matchesShortcut(event, getBinding('newTab')) || matchesShortcut(event, getBinding('treeNewFileAlt'))) return 'file'
  return null
}

/** Browser tab commands target the focused mew surface; legacy bindings remain valid. */
export function captureAppTabShortcuts({ closeEditorTab, create }: {
  closeEditorTab: () => void; create: (event: KeyboardEvent, kind: 'file' | 'folder') => void
}): () => void {
  const key = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    const command = appTabShortcut(event)
    if (command === 'close') {
      closeFocusedTab(event, closeEditorTab)
      return
    }
    if (!command) return
    if (command === 'file' && openFocusedTab(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const target = event.target instanceof HTMLElement ? event.target : document.activeElement
    if (event.repeat || event.isComposing || target?.closest('[role="dialog"], [aria-modal="true"]')) return
    create(event, command)
  }
  window.addEventListener('keydown', key, true)
  return () => window.removeEventListener('keydown', key, true)
}
