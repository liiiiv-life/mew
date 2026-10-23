export function captureCommandMenuShortcut(open: () => void): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing
      || (event.code !== 'KeyE' && event.key.toLowerCase() !== 'e')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!event.repeat) open()
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}

export function focusFirstCommand(menu: HTMLElement | null) {
  menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
}

export function navigateCommandMenu(event: KeyboardEvent, menu: HTMLElement) {
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const rows = Array.from(menu.querySelectorAll<HTMLElement>('[data-command-row]'))
    .map(row => Array.from(row.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')))
    .filter(row => row.length > 0)
  if (!rows.length) return
  event.preventDefault()
  event.stopPropagation()
  const active = menu.ownerDocument.activeElement
  const rowIndex = rows.findIndex(row => row.includes(active as HTMLButtonElement))
  const column = rowIndex < 0 ? 0 : rows[rowIndex].indexOf(active as HTMLButtonElement)
  let target: HTMLButtonElement
  if (event.key === 'Home') target = rows[0][0]
  else if (event.key === 'End') target = rows.at(-1)![0]
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const row = rows[Math.max(0, rowIndex)]
    target = row[(column + (event.key === 'ArrowRight' ? 1 : -1) + row.length) % row.length]
  } else {
    const step = event.key === 'ArrowDown' ? 1 : -1
    const origin = rowIndex < 0 ? (step > 0 ? -1 : 0) : rowIndex
    const row = rows[(origin + step + rows.length) % rows.length]
    target = row[Math.min(column, row.length - 1)]
  }
  target.focus()
}
