import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import { outsideTerminal } from './terminalFocus.ts'

const window = new Window({ url: 'http://localhost' })
Object.defineProperty(globalThis, 'HTMLElement', { value: window.HTMLElement, configurable: true })
Object.defineProperty(globalThis, 'document', { value: window.document, configurable: true })

test('xterm 입력 요소에서 발생한 Esc는 패널 닫기 대상이 아니다', () => {
  const terminal = document.createElement('div')
  terminal.className = 'xterm'
  const input = document.createElement('textarea')
  terminal.appendChild(input)
  document.body.appendChild(terminal)

  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  let result: boolean | null = null
  input.addEventListener('keydown', (current) => {
    result = outsideTerminal(current as unknown as KeyboardEvent)
  })
  input.dispatchEvent(event)

  assert.equal(result, false)
  terminal.remove()
})

test('xterm이 포커스된 동안 event target이 바깥을 가리켜도 Esc로 패널을 닫지 않는다', () => {
  const terminal = document.createElement('div')
  terminal.className = 'xterm'
  const input = document.createElement('textarea')
  terminal.appendChild(input)
  document.body.appendChild(terminal)
  input.focus()

  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  document.body.dispatchEvent(event)

  assert.equal(outsideTerminal(event as unknown as KeyboardEvent), false)
  terminal.remove()
})

test('터미널 밖의 Esc는 패널을 닫을 수 있다', () => {
  const button = document.createElement('button')
  document.body.appendChild(button)
  button.focus()
  const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
  button.dispatchEvent(event)

  assert.equal(outsideTerminal(event as unknown as KeyboardEvent), true)
  button.remove()
})
