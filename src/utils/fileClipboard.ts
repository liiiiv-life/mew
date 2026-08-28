// FileTree는 루트 프로젝트를 바꿀 때 unmount된다. 파일 복사 대상은 탭 전환 뒤에도 남아야 하므로
// 브라우저 메모리에서 한 번만 소유한다. OS 클립보드나 계정 상태에는 넣지 않는다.
export type FileClipboard = {
  path: string
  type: 'file' | 'dir'
  mode: 'copy' | 'cut'
  /** 복사할 때 보고 있던 루트 프로젝트. 다른 루트로 붙여넣을 때만 서버에 함께 보낸다. */
  workspacePath: string | null
} | null

let clipboard: FileClipboard = null

export function readFileClipboard(): FileClipboard {
  return clipboard
}

export function writeFileClipboard(value: FileClipboard) {
  clipboard = value
}
