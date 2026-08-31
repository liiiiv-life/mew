import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'
import type { RefObject } from 'react'

const win = new Window({ url: 'http://localhost' })
const globals = win as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'Node', 'HTMLElement', 'KeyboardEvent']) {
  if (key in globalThis) continue
  Object.defineProperty(globalThis, key, { value: globals[key], configurable: true })
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })

const { dispatchFocusedShortcut, useFocusedShortcutScope } = await import('./focusedShortcutScope.ts')
const [{ createElement, createRef, act }, { createRoot }] = await Promise.all([import('react'), import('react-dom/client')])

function Scope({ rootRef, onClose }: { rootRef: RefObject<HTMLDivElement | null>; onClose: () => boolean }) {
  useFocusedShortcutScope(rootRef, { closeTab: onClose })
  return createElement('div', { ref: rootRef }, createElement('input'))
}

test('포커스된 표면만 탭 닫기 단축키를 소비한다', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const firstRef = createRef<HTMLDivElement>()
  const secondRef = createRef<HTMLDivElement>()
  const closed: string[] = []

  await act(async () => {
    root.render(createElement('div', null,
      createElement(Scope, { rootRef: firstRef, onClose: () => { closed.push('first'); return true } }),
      createElement(Scope, { rootRef: secondRef, onClose: () => { closed.push('second'); return true } }),
    ))
  })

  const firstInput = firstRef.current?.querySelector('input')
  const secondInput = secondRef.current?.querySelector('input')
  firstInput?.focus()
  const firstEvent = new window.KeyboardEvent('keydown', { key: 'w', altKey: true, bubbles: true })
  assert.equal(dispatchFocusedShortcut('closeTab', firstEvent), 'handled')
  assert.deepEqual(closed, ['first'])

  secondInput?.focus()
  const secondEvent = new window.KeyboardEvent('keydown', { key: 'w', altKey: true, bubbles: true })
  assert.equal(dispatchFocusedShortcut('closeTab', secondEvent), 'handled')
  assert.deepEqual(closed, ['first', 'second'])

  await act(async () => root.unmount())
  host.remove()
})

test('닫을 탭이 없는 포커스 표면은 브라우저 Ctrl+W를 양보한다', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const panelRef = createRef<HTMLDivElement>()

  await act(async () => {
    root.render(createElement(Scope, { rootRef: panelRef, onClose: () => false }))
  })

  panelRef.current?.querySelector('input')?.focus()
  assert.equal(dispatchFocusedShortcut('closeTab', new window.KeyboardEvent('keydown', { bubbles: true })), 'unhandled-in-scope')

  await act(async () => root.unmount())
  host.remove()
})
