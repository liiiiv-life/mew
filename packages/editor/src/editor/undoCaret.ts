// undo/redo 전후 문서를 diff해 실제 바뀐 자리를 찾는다. y-tiptap이 복원하는 커서는 상대 위치가
// 이미 지워진 Y 아이템을 가리키면 엉뚱한 곳(문서 끝)으로 매핑되므로 믿지 않는다 — Editor.tsx의
// runUndoRedoKeepingView가 이 위치로 커서·스크롤을 옮긴다.
import type { Node as PMNode } from '@tiptap/pm/model'

/** 바뀐 구간의 끝 위치(입력을 이어가던 느낌의 자리). 문서가 안 바뀌었으면 null */
export function changedCaretPos(before: PMNode, after: PMNode): number | null {
  const start = before.content.findDiffStart(after.content)
  if (start === null) return null
  const end = after.content.findDiffEnd(before.content)
  // 반복 문자처럼 삽입·삭제 구간이 겹치면 diffEnd가 diffStart보다 앞설 수 있어 diffStart로 받친다
  return Math.min(end ? Math.max(end.a, start) : start, after.content.size)
}
