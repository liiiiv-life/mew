// 와이어 포맷 대조: syncCodec의 출력이 y-protocols/sync의 출력과 **바이트 단위로 같아야** 한다.
// 클라이언트(src/hooks/useCollab.ts)는 y-protocols를 계속 쓰므로, 여기가 한 바이트라도 어긋나면
// 서버를 배포한 순간 열려 있는 모든 탭의 협업이 조용히 깨진다. ADR 0035.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import { writeSyncStep1, writeSyncStep2, writeUpdate, messageYjsSyncStep1, messageYjsSyncStep2, messageYjsUpdate } from 'y-protocols/sync'
import { encodeAwarenessUpdate, Awareness } from 'y-protocols/awareness'
import {
  MESSAGE_SYNC,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
  decodeMessage,
  encodeAwarenessFrame,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeSyncUpdate,
} from './syncCodec.ts'

/** y-protocols로 프레임을 만든다 (서버가 지금까지 쓰던 방식) */
function reference(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  write(encoder)
  return encoding.toUint8Array(encoder)
}

test('상수가 y-protocols의 메시지 종류 값과 같다', () => {
  assert.equal(SYNC_STEP1, messageYjsSyncStep1)
  assert.equal(SYNC_STEP2, messageYjsSyncStep2)
  assert.equal(SYNC_UPDATE, messageYjsUpdate)
})

test('step1 프레임이 y-protocols와 바이트 단위로 같다', () => {
  const doc = new Y.Doc()
  doc.getText('t').insert(0, '내용이 좀 있는 문서')
  assert.deepEqual(encodeSyncStep1(Y.encodeStateVector(doc)), reference((e) => writeSyncStep1(e, doc)))
})

test('step2 프레임이 y-protocols와 바이트 단위로 같다', () => {
  const doc = new Y.Doc()
  doc.getText('t').insert(0, '전체 상태')
  // 상태 벡터 없는 step2 = 전체 상태 (writeSyncStep2의 두 번째 인자 생략과 같다)
  assert.deepEqual(encodeSyncStep2(Y.encodeStateAsUpdate(doc)), reference((e) => writeSyncStep2(e, doc)))

  // 상대 상태 벡터가 있을 때의 diff도 대조
  const other = new Y.Doc()
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
  doc.getText('t').insert(0, '추가분 ')
  const sv = Y.encodeStateVector(other)
  assert.deepEqual(
    encodeSyncStep2(Y.encodeStateAsUpdate(doc, sv)),
    reference((e) => writeSyncStep2(e, doc, sv)),
  )
})

test('update 프레임이 y-protocols와 바이트 단위로 같다', () => {
  const doc = new Y.Doc()
  let captured: Uint8Array | null = null
  doc.on('update', (u: Uint8Array) => {
    captured = u
  })
  doc.getText('t').insert(0, '증분')
  assert.ok(captured)
  const update = captured as unknown as Uint8Array
  assert.deepEqual(encodeSyncUpdate(update), reference((e) => writeUpdate(e, update)))
})

test('awareness 프레임이 기존 서버 인코딩과 같다', () => {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  awareness.setLocalStateField('user', { name: '테스터', color: '#a855f7' })
  const payload = encodeAwarenessUpdate(awareness, [awareness.clientID])
  const expected = encoding.createEncoder()
  encoding.writeVarUint(expected, 1)
  encoding.writeVarUint8Array(expected, payload)
  assert.deepEqual(encodeAwarenessFrame(payload), encoding.toUint8Array(expected))
  awareness.destroy()
})

test('만든 프레임을 되읽으면 원래 payload가 나온다', () => {
  const payload = new Uint8Array([1, 2, 3, 250, 0, 128])
  assert.deepEqual(decodeMessage(encodeSyncStep1(payload)), { channel: 'sync', syncType: SYNC_STEP1, payload })
  assert.deepEqual(decodeMessage(encodeSyncStep2(payload)), { channel: 'sync', syncType: SYNC_STEP2, payload })
  assert.deepEqual(decodeMessage(encodeSyncUpdate(payload)), { channel: 'sync', syncType: SYNC_UPDATE, payload })
  assert.deepEqual(decodeMessage(encodeAwarenessFrame(payload)), { channel: 'awareness', payload })
})

test('신뢰할 수 없는 바이트에 던지지 않고 null을 준다', () => {
  // 클라이언트가 보내는 바이트다 — 던지면 연결 처리가 죽는다
  assert.equal(decodeMessage(new Uint8Array([])), null)
  assert.equal(decodeMessage(new Uint8Array([7])), null, '알 수 없는 채널')
  assert.equal(decodeMessage(new Uint8Array([MESSAGE_SYNC, 9])), null, '알 수 없는 sync 종류')
  assert.equal(decodeMessage(new Uint8Array([MESSAGE_SYNC])), null, '종류가 잘림')
  assert.equal(decodeMessage(new Uint8Array([MESSAGE_SYNC, SYNC_UPDATE])), null, 'payload가 잘림')
  assert.equal(decodeMessage(new Uint8Array([MESSAGE_SYNC, SYNC_UPDATE, 200, 1])), null, '길이가 실제보다 큼')
})
