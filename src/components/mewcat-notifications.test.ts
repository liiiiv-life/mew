import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { Window } from 'happy-dom'

const win = new Window({ url: 'https://localhost' })
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Event', 'CustomEvent']) {
  Object.defineProperty(globalThis, key, { value: (win as unknown as Record<string, unknown>)[key], configurable: true })
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
Object.defineProperty(win, 'isSecureContext', { value: true, configurable: true })
localStorage.setItem('mew:locale', 'en')
registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only the external HTTP boundary is replaced; hook delivery and UI use real modules.
    if (specifier === '../api/client' && context.parentURL?.endsWith('/use-mewcat-notifications.ts')) {
      return { url: 'data:text/javascript,export const fetchSystemStats = async () => { throw new Error("unexpected poll") }', shortCircuit: true }
    }
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const base = new URL(specifier, context.parentURL)
      for (const extension of ['.ts', '.tsx']) {
        const url = new URL(base.href + extension)
        if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context)
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText }
    return nextLoad(url, context)
  },
})
const [{ createElement: h, act }, { createRoot }, { I18nProvider }, ui, store, { useMewcatNotifications }] = await Promise.all([
  import('react'), import('react-dom/client'), import('../i18n.tsx'), import('./mewcat-notifications.tsx'),
  import('../utils/mewcat-notifications.ts'), import('../hooks/use-mewcat-notifications.ts'),
])

async function mount(child: ReturnType<typeof h>) {
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  await act(async () => root.render(h(I18nProvider, null, child)))
  return { element, close: async () => { await act(async () => root.unmount()); element.remove() } }
}

test('hidden cat retains actionable notices, dismiss and visual preference work', async () => {
  store.clearMewcatNotices()
  store.setNotificationPreferences({ visual: true })
  const view = await mount(h(ui.MewcatNotifications, { hasCat: false }))
  const opened: unknown[] = []
  const listen = (event: Event) => opened.push((event as CustomEvent).detail.target)
  window.addEventListener(store.OPEN_NOTICE_EVENT, listen)
  await act(async () => store.publishMewcatNotice({ key: 'ui-error', kind: 'error', level: 'danger', source: 'Codex', target: { tabId: 'tab', cwd: '/work' } }))
  assert.match(view.element.textContent!, /encountered an error/)
  assert.ok(!view.element.querySelector('.mewcat-notifications-with-cat'))
  await act(async () => [...view.element.querySelectorAll('button')].find(button => button.textContent === 'Open conversation')!.click())
  assert.deepEqual(opened, [{ tabId: 'tab', cwd: '/work' }])
  assert.equal(view.element.querySelector('aside'), null)
  await act(async () => store.publishMewcatNotice({ key: 'ui-memory', kind: 'memory', level: 'warning', source: '95%', target: 'system' }))
  await act(async () => store.setNotificationPreferences({ visual: false }))
  assert.equal(view.element.querySelector('aside'), null)
  await act(async () => store.setNotificationPreferences({ visual: true }))
  assert.match(view.element.textContent!, /memory is running low/)
  await act(async () => (view.element.querySelector('[aria-label="Dismiss notification"]') as HTMLElement).click())
  assert.equal(view.element.querySelector('aside'), null)
  window.removeEventListener(store.OPEN_NOTICE_EVENT, listen)
  await view.close()
})

test('unsupported desktop API leaves in-app settings usable', async () => {
  const view = await mount(h(ui.MewcatNotificationSettings))
  assert.match(view.element.textContent!, /HTTPS or localhost/)
  const inputs = view.element.querySelectorAll('input')
  assert.equal(inputs[1].disabled, true)
  assert.equal(inputs[0].disabled, false)
  assert.equal(inputs[2].disabled, false)
  await view.close()
})

test('OS delivery requires permission, preference and an inactive window; payload omits source', async () => {
  class FakeNotification {
    static permission = 'granted'
    static sent: FakeNotification[] = []
    title: string
    options: NotificationOptions
    onclick: (() => void) | null = null
    onclose: (() => void) | null = null
    closed = false
    constructor(title: string, options: NotificationOptions) { this.title = title; this.options = options; FakeNotification.sent.push(this) }
    close() { this.closed = true; this.onclose?.() }
  }
  Object.defineProperty(globalThis, 'Notification', { value: FakeNotification, configurable: true })
  let focused = true
  Object.defineProperty(document, 'hasFocus', { value: () => focused, configurable: true })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  store.setNotificationPreferences({ desktop: true, sound: false })
  function Harness() { useMewcatNotifications(false, 'user@example.test'); return null }
  const view = await mount(h(Harness))
  const send = (key: string) => store.publishMewcatNotice({ key, kind: 'error', level: 'danger', source: 'SECRET project name' })
  await act(async () => send('focused'))
  assert.equal(FakeNotification.sent.length, 0)
  focused = false
  await act(async () => send('unfocused'))
  assert.equal(FakeNotification.sent.length, 1)
  assert.ok(!JSON.stringify(FakeNotification.sent[0]).includes('SECRET'))
  assert.equal(FakeNotification.sent[0].options.silent, true)
  FakeNotification.permission = 'denied'
  await act(async () => send('denied'))
  assert.equal(FakeNotification.sent.length, 1)
  FakeNotification.permission = 'granted'
  await act(async () => store.setNotificationPreferences({ desktop: false }))
  await act(async () => send('disabled'))
  assert.equal(FakeNotification.sent.length, 1)
  await view.close()
  assert.equal(FakeNotification.sent[0].closed, true)
  Reflect.deleteProperty(globalThis, 'Notification')
})
