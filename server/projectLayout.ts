import path from 'node:path'
import { DATA_DIR, readJsonRecord, writeFileAtomic } from './dataDir.ts'

// 프로젝트 선택 창의 타일 배치(격자 칸 번호)도 아이콘과 마찬가지로 팀 공용 설정이라 .data/에 서버 저장한다
const LAYOUT_FILE = path.join(DATA_DIR, 'project-layout.json')

/** 프로젝트 이름 → 격자 칸 번호(0부터, 빈 칸 허용) */
export function readProjectLayout(): Record<string, number> {
  try {
    return readJsonRecord<number>(LAYOUT_FILE) ?? {}
  } catch {
    return {}
  }
}

export function writeProjectLayout(layout: Record<string, number>): void {
  writeFileAtomic(LAYOUT_FILE, `${JSON.stringify(layout, null, 2)}\n`, 0o644)
}
