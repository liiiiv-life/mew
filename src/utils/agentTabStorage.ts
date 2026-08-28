/**
 * `.workspace` API 이름은 모든 루트 프로젝트에서 같으므로, 브라우저 탭 상태는 루트 절대 경로까지
 * 포함해야 한다. 경로를 JSON 문자열로 넣어 구분자 충돌 없이 localStorage 키를 만든다.
 */
export function agentTabStorageKey(key: string, workspacePath: string | null): string {
  return workspacePath ? `${key}:${JSON.stringify(workspacePath)}` : key
}
