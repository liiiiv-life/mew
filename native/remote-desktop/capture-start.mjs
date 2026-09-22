import { nativeCapture } from './native-capture.mjs'

// Wait for pixels, not just cursor updates. Keep one duplication retry for
// display transitions, but don't spend two seconds probing an empty desktop.
const FIRST_FRAME_WAIT_MS = 300
export async function startWindowsCapture(bounds, {
  open = nativeCapture, stopped = () => false, now = () => performance.now(),
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  let capture
  const release = async () => { const previous = capture; capture = null; await previous?.close() }
  try {
    for (let attempt = 0; attempt < 2 && !stopped(); attempt++) {
      capture = await open(bounds, 'dxgi')
      const until = now() + FIRST_FRAME_WAIT_MS
      while (!stopped()) {
        const first = await capture.next()
        if (stopped()) break
        if (first.pixels) return { capture, first }
        const remaining = until - now()
        if (remaining <= 0) break
        await pause(Math.min(16, remaining))
      }
      await release()
    }
  } catch { await release() }
  if (stopped()) return null
  try {
    capture = await open(bounds, 'gdi')
    if (!stopped()) {
      const first = await capture.next()
      if (!stopped() && first.pixels) return { capture, first }
    }
  } catch { /* Both native backends unavailable: retain Chromium fallback. */ }
  await release()
  return null
}
