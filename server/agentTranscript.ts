// ACP 히스토리는 메시지 본문만 다시 흘리고 Mew turn_end(소요 시간·종료 이유)는 보존하지 않는다.
// 완료 턴의 화면 전사를 DATA_DIR에 남겨 감독의 유휴 종료 뒤에도 같은 정보를 복원한다.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import type { AgentEvent } from './agentAcp.ts'

const TRANSCRIPT_DIR = path.join(DATA_DIR, 'agent-transcripts')
const VERSION = 1
const MAX_EVENTS = 500

type StoredTranscript = {
  version: typeof VERSION
  runtime: string
  cwd: string
  sessionId: string
  events: AgentEvent[]
}

function transcriptFile(runtime: string, cwd: string, sessionId: string): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify([runtime, cwd, sessionId])).digest('hex')
  return path.join(TRANSCRIPT_DIR, `${digest}.json`)
}

/** 완료된 턴만 동기 저장한다 — 스트리밍 청크마다 디스크를 쓰지 않는다. */
export function writeAgentTranscript(runtime: string, cwd: string, sessionId: string, events: AgentEvent[]): void {
  if (!sessionId) return
  const value: StoredTranscript = { version: VERSION, runtime, cwd, sessionId, events: events.slice(-MAX_EVENTS) }
  try {
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true, mode: 0o700 })
    writeFileAtomic(transcriptFile(runtime, cwd, sessionId), `${JSON.stringify(value)}\n`)
  } catch (err) {
    // 이 파일은 복원 품질을 높이는 보조 기록이다. 저장 실패가 이미 끝난 작업을 실패로 바꾸지 않는다.
    console.error('[mew:agent] 전사 저장 실패:', err)
  }
}

/** 현재 런타임·작업 경로·ACP 세션 ID가 모두 같은 전사만 되돌린다. */
export function readAgentTranscript(runtime: string, cwd: string, sessionId: string): AgentEvent[] | null {
  try {
    const value = readJsonFile<unknown>(transcriptFile(runtime, cwd, sessionId))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const stored = value as Partial<StoredTranscript>
    if (stored.version !== VERSION || stored.runtime !== runtime || stored.cwd !== cwd || stored.sessionId !== sessionId || !Array.isArray(stored.events)) return null
    return stored.events as AgentEvent[]
  } catch {
    return null
  }
}
