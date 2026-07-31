import type { MouseEvent } from 'react'

/**
 * 컨테이너에 걸어 두면 그 안 버튼을 눌러도 포커스가 옮겨가지 않게 하는 mousedown 핸들러.
 *
 * 모바일에서 소프트 키보드가 떠 있을 때 버튼을 탭하면 그 탭이 입력칸의 포커스를 뺏어 키보드가 내려간다.
 * 키보드가 내려가면 레이아웃 뷰포트가 그만큼 커지고(index.html의 `interactive-widget=resizes-content`)
 * 화면 아래쪽 버튼들이 손가락 밑에서 쑥 밀려 내려간다 — mousedown과 mouseup이 서로 다른 요소에서
 * 끝나므로 브라우저는 click을 발생시키지 않는다. **첫 탭은 키보드만 닫히고 두 번째 탭에야 눌리던** 이유다.
 *
 * mousedown의 기본 동작(포커스 이동)만 막으면 포커스가 그대로 남아 키보드도 안 내려가고 click이 곧바로
 * 온다. 터치에서도 브라우저가 mousedown을 합성해 보내므로 이 하나로 충분하다. 버튼 바깥(입력칸·터미널
 * 화면 등)은 건드리지 않으므로 평소의 포커스 이동·텍스트 선택은 그대로다.
 */
export function keepFocusOnPress(e: MouseEvent) {
  if (e.target instanceof Element && e.target.closest('button')) e.preventDefault()
}
