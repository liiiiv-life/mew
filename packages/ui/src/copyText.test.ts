// 복사는 http로 열었을 때(폰·Tailscale) navigator.clipboard가 아예 없다 — 폴백이 살아 있는지가 요점이다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
const w = win as unknown as Record<string, unknown>
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event', 'navigator']) {
  if (k in globalThis) continue
  try {
    ;(globalThis as Record<string, unknown>)[k] = w[k]
  } catch {
    Object.defineProperty(globalThis, k, { value: w[k], configurable: true })
  }
}

const { copyText } = await import('./copyText.ts')

/** navigator.clipboard 유무를 갈아끼운다 — 보안 컨텍스트가 아니면 이 값이 통째로 없다 */
function setClipboard(value: unknown) {
  Object.defineProperty(globalThis.navigator, 'clipboard', { value, configurable: true })
}

test('보안 컨텍스트에서는 Clipboard API를 쓴다', async () => {
  const written: string[] = []
  setClipboard({ writeText: (text: string) => (written.push(text), Promise.resolve()) })
  assert.equal(await copyText('안녕'), true)
  assert.deepEqual(written, ['안녕'])
})

test('clipboard가 없으면(http 접속) execCommand로 폴백한다', async () => {
  setClipboard(undefined)
  let copied: string | null = null
  globalThis.document.execCommand = () => {
    // 폴백은 임시 textarea를 붙였다 select()한 뒤에 부른다 — 그 값이 실제 복사 대상이다
    const ta = globalThis.document.querySelector('textarea')
    copied = ta ? (ta as HTMLTextAreaElement).value : null
    return true
  }
  assert.equal(await copyText('폰에서 복사'), true)
  assert.equal(copied, '폰에서 복사')
  assert.equal(globalThis.document.querySelector('textarea'), null, '임시 textarea는 지우고 나간다')
})

test('Clipboard API가 거부하면 폴백을 거쳐 결과를 그대로 돌려준다', async () => {
  setClipboard({ writeText: () => Promise.reject(new Error('denied')) })
  globalThis.document.execCommand = () => false
  assert.equal(await copyText('실패'), false)
})

test('빈 문자열은 복사하지 않는다', async () => {
  let called = false
  setClipboard({ writeText: () => ((called = true), Promise.resolve()) })
  assert.equal(await copyText(''), false)
  assert.equal(called, false)
})
