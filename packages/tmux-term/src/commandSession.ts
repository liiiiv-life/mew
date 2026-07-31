// 명령어 버튼이 만드는 tmux 세션은 특수 프리픽스를 붙여 터미널 탭 목록에서 숨긴다(무시 처리).
// 클라이언트(탭 필터)와 서버(세션 이름 생성) 양쪽에서 같은 규칙을 써야 하므로 여기 한 곳에 둔다 —
// node·브라우저 어디서도 도는 순수 모듈이라 양쪽 진입점(index.ts / server/index.ts)에서 재노출한다.
export const COMMAND_SESSION_PREFIX = 'mewcmd-'

/** 명령어 버튼 전용 세션인지 — 터미널 탭 목록은 이걸 걸러낸다 */
export function isCommandSession(name: string): boolean {
  return name.startsWith(COMMAND_SESSION_PREFIX)
}
