/** 홈 탭이 API·트리 요청에서 사용하는 워크스페이스 특수 스코프. */
export const WORKSPACE_PROJECT = '.workspace'

const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 옛 /{프로젝트} 주소를 우선하고, 아니면 마지막으로 보던 프로젝트·홈을 복원한다. */
export function detectInitialProject(pathname: string, saved: string | null): string {
  let segment = ''
  try {
    segment = decodeURIComponent(pathname.split('/')[1] ?? '')
  } catch {
    // 깨진 URL 조각은 저장값이나 docs 폴백으로 넘긴다.
  }
  if (PROJECT_NAME_RE.test(segment)) return segment
  if (saved === WORKSPACE_PROJECT) return saved
  return saved && PROJECT_NAME_RE.test(saved) ? saved : 'docs'
}
