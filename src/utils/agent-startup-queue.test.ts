import test from 'node:test'
import assert from 'node:assert/strict'
import { AgentStartupQueue } from './agent-startup-queue.ts'

test('준비된 메시지는 FIFO로 한 번씩 보내고 성공한 항목은 즉시 제거한다', () => {
  const queue = new AgentStartupQueue<string>()
  const firstId = queue.enqueue('첫 메시지')
  const secondId = queue.enqueue('다음 메시지')
  assert.notEqual(firstId, secondId)
  const sent: string[] = []
  assert.equal(queue.flush(payload => {
    if (payload === '다음 메시지') assert.deepEqual(queue.snapshot().map(entry => entry.id), [secondId])
    sent.push(payload)
    return true
  }), 2)
  assert.deepEqual(sent, ['첫 메시지', '다음 메시지'])
  assert.deepEqual(queue.snapshot(), [])
  assert.equal(queue.flush(() => { throw new Error('중복 전송') }), 0)
})

test('스냅샷은 변경 전까지 같은 참조이며 이전 배열과 wrapper를 변경하지 않는다', () => {
  const queue = new AgentStartupQueue<string>()
  const empty = queue.snapshot()
  assert.equal(queue.snapshot(), empty)
  const id = queue.enqueue('메시지')
  const first = queue.snapshot()
  assert.notEqual(first, empty)
  assert.deepEqual(empty, [])
  assert.equal(queue.snapshot(), first)
  assert.equal(Object.isFrozen(first), true)
  assert.equal(Object.isFrozen(first[0]), true)
  assert.throws(() => Object.assign(first[0], { id: 999 }), TypeError)
  const secondId = queue.enqueue('추가 메시지')
  assert.equal(queue.snapshot()[0], first[0])
  queue.remove(id)
  assert.deepEqual(first, [{ id, payload: '메시지' }])
  assert.deepEqual(queue.snapshot(), [{ id: secondId, payload: '추가 메시지' }])
  const unchanged = queue.snapshot()
  queue.remove(id)
  assert.equal(queue.snapshot(), unchanged)
})

test('취소한 항목은 보내지 않으며 clear 뒤에도 id를 재사용하지 않는다', () => {
  const queue = new AgentStartupQueue<string>()
  queue.enqueue('처음')
  const cancelled = queue.enqueue('취소')
  const lastId = queue.enqueue('마지막')
  queue.remove(cancelled)
  const sent: string[] = []
  assert.equal(queue.flush(payload => { sent.push(payload); return true }), 2)
  assert.deepEqual(sent, ['처음', '마지막'])
  queue.enqueue('지울 메시지')
  const beforeClear = queue.snapshot()
  queue.clear()
  const empty = queue.snapshot()
  assert.deepEqual(empty, [])
  assert.equal(beforeClear.length, 1)
  queue.clear()
  assert.equal(queue.snapshot(), empty)
  assert.ok(queue.enqueue('새 메시지') > lastId)
})

for (const failure of ['false', 'throw'] as const) {
  test(`${failure} 전송 뒤에는 성공한 항목을 제외한 나머지를 재시도한다`, () => {
    const queue = new AgentStartupQueue<string>()
    queue.enqueue('성공')
    const failedId = queue.enqueue('실패')
    const laterId = queue.enqueue('대기')
    const sent: string[] = []
    assert.equal(queue.flush(payload => {
      if (payload === '실패') {
        if (failure === 'throw') throw new Error('연결 끊김')
        return false
      }
      sent.push(payload)
      return true
    }), 1)
    assert.deepEqual(queue.snapshot().map(entry => entry.id), [failedId, laterId])
    const failed = queue.snapshot()
    assert.equal(queue.flush(() => false), 0)
    assert.equal(queue.snapshot(), failed)
    assert.equal(queue.flush(payload => { sent.push(payload); return true }), 2)
    assert.deepEqual(sent, ['성공', '실패', '대기'])
  })
}

test('send 안에서 flush와 enqueue가 재진입해도 중복 없이 FIFO로 보낸다', () => {
  const queue = new AgentStartupQueue<string>()
  queue.enqueue('처음')
  queue.enqueue('둘째')
  const sent: string[] = []
  assert.equal(queue.flush(payload => {
    sent.push(payload)
    assert.equal(queue.flush(() => { throw new Error('재진입 전송') }), 0)
    if (payload === '처음') queue.enqueue('셋째')
    return true
  }), 3)
  assert.deepEqual(sent, ['처음', '둘째', '셋째'])
  assert.deepEqual(queue.snapshot(), [])
})

test('send 중 clear 뒤에 추가한 메시지도 잃지 않는다', () => {
  const queue = new AgentStartupQueue<string>()
  queue.enqueue('처음')
  queue.enqueue('취소할 메시지')
  const sent: string[] = []
  assert.equal(queue.flush(payload => {
    sent.push(payload)
    if (payload === '처음') {
      queue.clear()
      queue.enqueue('새 메시지')
    }
    return true
  }), 2)
  assert.deepEqual(sent, ['처음', '새 메시지'])
  assert.deepEqual(queue.snapshot(), [])
})

test('send 중 현재 항목이나 다음 항목을 취소해도 다른 메시지를 제거하지 않는다', () => {
  const queue = new AgentStartupQueue<string>()
  const firstId = queue.enqueue('처음')
  const cancelledId = queue.enqueue('취소')
  queue.enqueue('마지막')
  const sent: string[] = []
  assert.equal(queue.flush(payload => {
    sent.push(payload)
    if (payload === '처음') {
      queue.remove(firstId)
      queue.remove(cancelledId)
    }
    return true
  }), 2)
  assert.deepEqual(sent, ['처음', '마지막'])
})

test('첨부와 실행 설정을 포함한 payload는 복사하거나 동결하지 않고 그대로 전달한다', () => {
  const payload = {
    text: '첨부를 확인해 줘',
    attachments: [{ path: 'image.png', mimeType: 'image/png' }],
    modelId: 'selected-model',
    configValues: { mode: 'selected-mode', effort: 'high' },
  }
  const queue = new AgentStartupQueue<typeof payload>()
  queue.enqueue(payload)
  assert.equal(queue.snapshot()[0].payload, payload)
  assert.equal(Object.isFrozen(payload), false)
  assert.equal(Object.isFrozen(payload.attachments), false)
  assert.equal(Object.isFrozen(payload.configValues), false)
  assert.equal(queue.flush(actual => {
    assert.equal(actual, payload)
    assert.deepEqual(actual.attachments, [{ path: 'image.png', mimeType: 'image/png' }])
    assert.deepEqual(actual.configValues, { mode: 'selected-mode', effort: 'high' })
    return true
  }), 1)
})
