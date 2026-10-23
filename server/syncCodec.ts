// Yjs sync 프로토콜 봉투의 최소 구현. ADR 0035.
//
// 왜 y-protocols/sync를 그대로 안 쓰는가: 그 API(readSyncMessage·writeSyncStep2)는 JS `Y.Doc`
// 인스턴스를 인자로 받는다. 방의 상태가 Rust(yrs)로 갈 수 있으므로 "문서"와 "봉투"를 갈라놔야 한다.
// 봉투는 워낙 단순하고(타입 varUint + 본문 varUint8Array) 언어 중립이라 여기서 직접 다룬다.
//
// **와이어 포맷은 바뀌지 않는다** — 이 파일의 출력은 y-protocols의 출력과 바이트 단위로 같아야 하고,
// syncCodec.test.ts가 그걸 대조한다. 클라이언트(src/hooks/useCollab.ts)는 y-protocols를 계속 쓴다.
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

/** 바깥 채널 — 이 방으로 오는 메시지가 sync인지 awareness인지 */
export const MESSAGE_SYNC = 0
export const MESSAGE_AWARENESS = 1

/** sync 채널 안의 메시지 종류 (y-protocols/sync의 messageYjsSyncStep1·Step2·Update와 같은 값) */
export const SYNC_STEP1 = 0
export const SYNC_STEP2 = 1
export const SYNC_UPDATE = 2

function frame(channel: number, syncType: number, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, channel)
  encoding.writeVarUint(encoder, syncType)
  encoding.writeVarUint8Array(encoder, payload)
  return encoding.toUint8Array(encoder)
}

/** "네 상태 벡터를 보고 모자란 걸 주겠다" — 상태 벡터 요청. 문서 내용은 담지 않는다. */
export function encodeSyncStep1(stateVector: Uint8Array): Uint8Array {
  return frame(MESSAGE_SYNC, SYNC_STEP1, stateVector)
}

/** step1의 답 — 상대가 모자란 만큼의 업데이트. 접속 직후엔 요청 없이 전체 상태로 보낸다. */
export function encodeSyncStep2(update: Uint8Array): Uint8Array {
  return frame(MESSAGE_SYNC, SYNC_STEP2, update)
}

/** 증분 업데이트 브로드캐스트 */
export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  return frame(MESSAGE_SYNC, SYNC_UPDATE, update)
}

export function encodeAwarenessFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(encoder, payload)
  return encoding.toUint8Array(encoder)
}

export type DecodedMessage =
  | { channel: 'sync'; syncType: number; payload: Uint8Array }
  | { channel: 'awareness'; payload: Uint8Array }

/**
 * 프레임 하나를 읽는다. 알 수 없는 채널이거나 잘린 프레임이면 null —
 * 클라이언트가 보낸 바이트라 신뢰할 수 없고, 던지면 연결 처리 전체가 죽는다.
 */
export function decodeMessage(bytes: Uint8Array): DecodedMessage | null {
  try {
    const decoder = decoding.createDecoder(bytes)
    const channel = decoding.readVarUint(decoder)
    if (channel === MESSAGE_SYNC) {
      const syncType = decoding.readVarUint(decoder)
      if (syncType !== SYNC_STEP1 && syncType !== SYNC_STEP2 && syncType !== SYNC_UPDATE) return null
      return { channel: 'sync', syncType, payload: decoding.readVarUint8Array(decoder) }
    }
    if (channel === MESSAGE_AWARENESS) {
      return { channel: 'awareness', payload: decoding.readVarUint8Array(decoder) }
    }
    return null
  } catch {
    return null
  }
}
