type KeyboardCapture = (event: KeyboardEvent) => boolean
const captures = new Set<KeyboardCapture>()

// Install before component effects so exclusive surfaces keep priority when
// app listeners are re-registered or the remote connection becomes ready later.
if (typeof window !== 'undefined') {
  const route = (event: KeyboardEvent) => {
    for (const capture of [...captures].reverse()) {
      if (capture(event)) return
    }
  }
  window.addEventListener('keydown', route, true)
  window.addEventListener('keyup', route, true)
}

/** A focused exclusive surface handles keys before app shortcuts and editors. */
export function registerKeyboardCapture(capture: KeyboardCapture): () => void {
  captures.add(capture)
  return () => { captures.delete(capture) }
}
