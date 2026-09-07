/**
 * 터미널(xterm) 바깥에서 눌린 키인지. 터미널 안의 Esc는 vim 등 실행 중인 프로그램의 몫이라
 * 오버레이가 가로채면 안 된다 — useOverlayDismiss의 closeOnEscape로 넘겨 쓴다.
 */
export function outsideTerminal(event: KeyboardEvent): boolean {
  const eventTarget = event.target instanceof HTMLElement ? event.target : null
  const activeTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
  return !eventTarget?.closest('.xterm') && !activeTarget?.closest('.xterm')
}
