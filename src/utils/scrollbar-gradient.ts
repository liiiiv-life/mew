/** Keep each native scrollbar's highlight aligned with its own scroll progress. */
export function startScrollbarGradientTracking() {
  const pending = new Set<HTMLElement>()
  let frame = 0

  const percentage = (offset: number, range: number) =>
    `${range > 0 ? Math.max(0, Math.min(1, offset / range)) * 100 : 0}%`

  const flush = () => {
    frame = 0
    for (const element of pending) {
      if (!element.isConnected) continue
      element.style.setProperty('--mew-scrollbar-y', percentage(element.scrollTop, element.scrollHeight - element.clientHeight))
      const range = element.scrollWidth - element.clientWidth
      const rtl = getComputedStyle(element).direction === 'rtl'
      element.style.setProperty('--mew-scrollbar-x', percentage(rtl ? range + element.scrollLeft : element.scrollLeft, range))
    }
    pending.clear()
  }

  const onScroll = (event: Event) => {
    const element = event.target === document ? document.scrollingElement : event.target
    if (!(element instanceof HTMLElement)) return
    pending.add(element)
    if (!frame) frame = requestAnimationFrame(flush)
  }

  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  return () => {
    document.removeEventListener('scroll', onScroll, true)
    cancelAnimationFrame(frame)
    pending.clear()
  }
}
