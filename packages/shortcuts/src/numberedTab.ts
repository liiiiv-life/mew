/** Alt+1…9 selects a tab by its one-based position, including macOS Option keys. */
export function numberedTabIndex(event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing' | 'code' | 'key'>): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return null
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1] ?? (/^[1-9]$/.test(event.key) ? event.key : null)
  return digit === null ? null : Number(digit) - 1
}
