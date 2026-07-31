import path from 'node:path'
import { DATA_DIR, readJsonRecord, writeFileAtomic } from './dataDir.ts'

// 프로젝트 아이콘은 팀 전체가 공유하는 설정이라 .data/에 서버 저장한다.
// 값은 `i:{키}`(라인 아이콘) 또는 이모지 문자 — utils/projectIcons.ts와 같은 표기.
const ICONS_FILE = path.join(DATA_DIR, 'project-icons.json')

/** 보여주기용 — 파일이 없거나 깨져 있어도 목록 조회는 실패하지 않게 빈 값으로 넘긴다 */
export function readProjectIcons(): Record<string, string> {
  try {
    return readJsonRecord<string>(ICONS_FILE) ?? {}
  } catch {
    return {}
  }
}

/**
 * 아이콘 하나를 설정하거나(icon) 지운다(null).
 * 읽기가 실패하면 저장하지 않고 던진다 — 못 읽은 걸 빈 목록으로 보고 덮어쓰면
 * 다른 프로젝트에 설정해둔 아이콘까지 한 번에 사라진다.
 */
export function setProjectIcon(project: string, icon: string | null): void {
  const icons = readJsonRecord<string>(ICONS_FILE) ?? {}
  if (icon) icons[project] = icon
  else if (!(project in icons)) return
  else delete icons[project]
  writeFileAtomic(ICONS_FILE, `${JSON.stringify(icons, null, 2)}\n`, 0o644)
}
