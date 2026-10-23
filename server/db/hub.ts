// /db 실시간 협업 이벤트 허브 — Postgres가 SSoT이고, 변경(mutation)은 여기로 방송된다.
// 단일 서버이므로 인프로세스 EventEmitter로 충분 (다중 서버로 확장 시 이 파일만 pub/sub 백엔드로 교체).
import { EventEmitter } from 'node:events'
import type { ColumnDef, RowData } from './databaseService.ts'

// 클라이언트는 이 이벤트를 받아 낙관적 업데이트를 조정(reconcile)한다.
export type DbEvent =
  | { type: 'row.insert'; row: RowData }
  | { type: 'row.update'; rowId: string; columnId: string; value: unknown }
  | { type: 'row.delete'; rowId: string }
  | { type: 'schema'; columns: ColumnDef[] } // 컬럼 추가/이름변경/삭제 → 클라이언트가 컬럼 세트를 교체
  | { type: 'title'; title: string } // 데이터베이스 제목 변경

const emitter = new EventEmitter()
emitter.setMaxListeners(0) // 룸(=구독) 수 제한 없음

// 룸 키: 프로젝트별로 분리되어 다른 프로젝트의 이벤트가 새지 않는다.
function roomKey(project: string, databaseId: string): string {
  return `${project}:${databaseId}`
}

export function publishDbEvent(project: string, databaseId: string, event: DbEvent): void {
  emitter.emit(roomKey(project, databaseId), event)
}

// 구독 해제 함수를 반환한다.
export function subscribeDb(project: string, databaseId: string, listener: (event: DbEvent) => void): () => void {
  const key = roomKey(project, databaseId)
  emitter.on(key, listener)
  return () => emitter.off(key, listener)
}
