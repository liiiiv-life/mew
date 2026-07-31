import fs from 'node:fs'
import path from 'node:path'
import { defaultDataDir } from './config.ts'

// 서버가 소유한 상태 파일들이 사는 곳 — 사용자·세션·게스트 규칙·프로젝트 아이콘·배치·터미널 버튼.
// 워크스페이스 밖이라 프로젝트 목록·편집 API에는 절대 노출되지 않는다(paths.ts deny).
// MEW_DATA_DIR로 바꿀 수 있어서 테스트가 실제 데이터를 건드리지 않는다 — 테스트는 실제 프로젝트를
// 만들었다 지우고, 그 과정에서 아이콘·배치 파일을 함께 고쳐 쓴다.
export const DATA_DIR = process.env.MEW_DATA_DIR ?? defaultDataDir()

/**
 * 같은 디렉터리에 임시 파일로 쓰고 rename — 파일이 "0바이트인 순간"을 만들지 않는다.
 * writeFileSync는 O_TRUNC로 열기 때문에 쓰는 도중 다른 프로세스가 읽으면 빈 내용을 보게 되고,
 * 읽기 실패를 빈 객체로 넘기는 코드와 만나면 저장돼 있던 설정이 통째로 날아간다.
 */
export function writeFileAtomic(file: string, content: string, mode = 0o600): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, content, { encoding: 'utf-8', mode })
  fs.renameSync(tmp, file)
}

export class DataFileError extends Error {}

/**
 * JSON 상태 파일을 읽는다. 파일이 없으면 `null`(아직 아무것도 저장 안 됨).
 * 내용이 깨져 있으면 사본을 남기고 던진다 — 읽지 못한 걸 빈 값으로 오해해서
 * 그 위에 덮어쓰면 남아 있던 데이터까지 지우게 되므로, 쓰기 경로는 반드시 이 실패를 봐야 한다.
 */
export function readJsonFile<T>(file: string): T | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new DataFileError(`상태 파일을 읽지 못했습니다: ${path.basename(file)}`)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    const backup = `${file}.corrupt-${Date.now()}`
    try {
      fs.copyFileSync(file, backup)
    } catch {
      /* 사본까지 실패하면 어쩔 수 없다 — 원본은 건드리지 않은 채로 둔다 */
    }
    throw new DataFileError(
      `상태 파일이 깨졌습니다: ${path.basename(file)} (사본: ${path.basename(backup)})`,
    )
  }
}

/** 이름→값 형태의 상태 파일 — 객체가 아닌 값(배열·null 등)은 손상으로 본다 */
export function readJsonRecord<T>(file: string): Record<string, T> | null {
  const parsed = readJsonFile<unknown>(file)
  if (parsed === null) return null
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DataFileError(`상태 파일 형식이 올바르지 않습니다: ${path.basename(file)}`)
  }
  return parsed as Record<string, T>
}
