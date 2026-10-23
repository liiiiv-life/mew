import type { KeyboardEvent } from 'react'

/** Open choice menus from their trigger without invoking an action in the menu. */
export function openDropdownOnArrow(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
    (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
  event.preventDefault()
  event.stopPropagation()
  if (event.currentTarget.getAttribute('aria-expanded') !== 'true') event.currentTarget.click()
}
