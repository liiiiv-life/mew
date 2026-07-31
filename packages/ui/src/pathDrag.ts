// 사이드바(파일 트리)에서 항목을 끌어 트리 **바깥**에 놓았을 때의 약속.
//
// 트리 안에서 놓으면 "그 폴더로 이동"이고, 에디터·터미널·터미널 입력칸에 놓으면 "그 파일의
// 프로젝트 상대경로가 그 자리에 입력"된다. 두 뜻을 한 드래그에 담기 위해 실어 보내는 것이 둘이다:
//
//  - 전용 MIME(`application/x-mew-path`) — "이건 우리 사이드바에서 온 경로다"라는 표시.
//    에디터는 이게 있을 때만 가로챈다. 없으면 바깥에서 끌어온 텍스트·이미지로 보고 원래대로 처리한다.
//  - `text/plain` — 전용 MIME을 모르는 곳(터미널 xterm, 입력칸)도 그냥 받을 수 있게.
const FILE_PATH_MIME = 'application/x-mew-path'

/** 끄는 쪽(사이드바 항목의 onDragStart)에서 부른다 */
export function setPathDragData(dt: DataTransfer, path: string): void {
  dt.setData(FILE_PATH_MIME, path)
  dt.setData('text/plain', path)
  // 'move'만 허용하면 dropEffect='copy'로 받는 쪽(에디터·터미널)에서 드롭이 통째로 거부된다.
  // 트리 안의 폴더는 자기 dragover에서 dropEffect='move'를 명시해 원래 뜻을 유지한다.
  dt.effectAllowed = 'copyMove'
}

/**
 * **dragover/dragenter에서** 쓴다 — 이 드래그가 사이드바 항목인지. 그 단계에서는 DataTransfer가
 * 보호 모드라 `getData()`가 언제나 빈 문자열이고 `types`만 읽을 수 있다. 여기서 pathFromDrag를 쓰면
 * 항상 null이 나와 preventDefault를 못 하고, 결국 drop 자체가 발생하지 않는다.
 */
export function hasPathDrag(dt: DataTransfer | null | undefined): boolean {
  return dt ? Array.prototype.includes.call(dt.types, FILE_PATH_MIME) : false
}

/** **drop에서** 쓴다 — 사이드바에서 끌어온 경로면 그 경로, 아니면 null (이때는 값을 읽을 수 있다) */
export function pathFromDrag(dt: DataTransfer | null | undefined): string | null {
  return dt?.getData(FILE_PATH_MIME) || null
}
