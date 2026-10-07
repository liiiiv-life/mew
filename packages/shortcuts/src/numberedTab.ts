type TabKeyEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'code' | 'key'>

function digitIndex(event: TabKeyEvent): number | null {
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : null)
  return digit === null ? null : Number(digit) - 1
}

/** Ctrl/Cmd+1…9 selects a tab in the focused panel by its one-based position. */
export function numberedTabIndex(event: TabKeyEvent): number | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing) return null
  return digitIndex(event)
}

/** Alt+1…9 selects a project tab, including physical Option keys and the keypad. */
export function projectTabIndex(event: TabKeyEvent): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return null
  return digitIndex(event)
}

/** Fixed aliases for moving within the focused panel; existing arrow shortcuts remain available. */
export function adjacentPanelTabDirection(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'code' | 'key'>): -1 | 1 | null {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.isComposing) {
    if (event.code === 'Tab' || event.key === 'Tab') return event.shiftKey ? -1 : 1
    if (!event.shiftKey && (event.code === 'PageUp' || event.key === 'PageUp')) return -1
    if (!event.shiftKey && (event.code === 'PageDown' || event.key === 'PageDown')) return 1
  }
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return null
  const key = event.code || `Key${event.key.toUpperCase()}`
  return key === 'KeyQ' ? -1 : key === 'KeyE' ? 1 : null
}
