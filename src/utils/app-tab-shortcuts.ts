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
  closeEditorTab: () => void; create: (event: KeyboardEvent, kind: 'file' | 'folder', target: Element) => void
}): () => void {
  let lastTarget: Element | null = document.activeElement
  const recordTarget = (event: Event) => {
    if (event.target instanceof Element) lastTarget = event.target
  }
  const key = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    const command = appTabShortcut(event)
    if (command === 'close') {
      closeFocusedTab(event, closeEditorTab)
      return
    }
    if (!command) return
    const target = document.activeElement?.tagName === 'IFRAME' ? document.activeElement
      : lastTarget ?? (event.target instanceof Element ? event.target : document.activeElement)
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.repeat || event.isComposing || !target?.isConnected || target.closest('[role="dialog"], [aria-modal="true"], [inert]') || !target.checkVisibility({ visibilityProperty: true })) return
    if (command === 'file' && openFocusedTab(event, target)) return
    const panel = target.closest<HTMLElement>('[data-workspace-panel]')?.dataset.workspacePanel
    if (panel !== 'editor' && panel !== 'sidebar') return
    create(event, command, target)
  }
  document.addEventListener('pointerdown', recordTarget, true)
  document.addEventListener('focusin', recordTarget, true)
  window.addEventListener('keydown', key, true)
  return () => {
    document.removeEventListener('pointerdown', recordTarget, true)
    document.removeEventListener('focusin', recordTarget, true)
    window.removeEventListener('keydown', key, true)
  }
}
