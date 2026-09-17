import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
const globals = win as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Event', 'KeyboardEvent']) {
  if (key in globalThis) continue
  Object.defineProperty(globalThis, key, { value: globals[key], configurable: true })
}
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })

// @mew/ui의 Vite 진입점은 확장자 없는 내부 import를 써 Node 단독 실행으로는 못 읽는다.
// 이 테스트가 쓰는 실제 export(useOverlayDismiss) 소스로만 곧장 연결한다.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@mew/ui') {
      return { url: new URL('../../packages/ui/src/useOverlayDismiss.ts', import.meta.url).href, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

const [{ createElement, useState, act }, { createRoot }, { useWorkspacePanelDismissals }] = await Promise.all([
  import('react'),
  import('react-dom/client'),
  import('./use-panel-dismissals.ts'),
])

const ids = ['sidebar', 'chat', 'agent', 'terminal', 'browser', 'android'] as const
type PanelId = (typeof ids)[number]

function Harness({ closed }: { closed: PanelId[] }) {
  const [open, setOpen] = useState<Record<PanelId, boolean>>(() =>
    Object.fromEntries(ids.map((id) => [id, true])) as Record<PanelId, boolean>,
  )
  const [stack, setStack] = useState<PanelId[]>([...ids])
  const panel = (id: PanelId) => ({
    open: open[id],
    close: () => {
      closed.push(id)
      setOpen((current) => ({ ...current, [id]: false }))
      setStack((current) => current.filter((panelId) => panelId !== id))
    },
  })
  useWorkspacePanelDismissals({
    sidebar: panel('sidebar'),
    chat: panel('chat'),
    agent: panel('agent'),
    terminal: panel('terminal'),
    browser: panel('browser'),
    android: panel('android'),
  }, stack.at(-1) ?? null)
  return null
}

function SidebarSearchHarness({ closed }: { closed: string[] }) {
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('mew')
  const shut = () => {
    closed.push('sidebar')
    setOpen(false)
  }
  const closedPanel = { open: false, close: () => {} }
  useWorkspacePanelDismissals({
    sidebar: {
      open,
      close: shut,
      closeOnEscape: () => {
        if (!query) return true
        setQuery('')
        return false
      },
    },
    chat: closedPanel,
    agent: closedPanel,
    terminal: closedPanel,
    browser: closedPanel,
    android: closedPanel,
  }, 'sidebar')
  return createElement('span', { 'data-query': query })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('only the foreground browser delegates Back; other panels and Escape still close', async () => {
  const closed: string[] = []
  let navigations = 0
  function BrowserBackHarness({ foreground, canGoBack }: { foreground: 'browser' | 'agent'; canGoBack: boolean }) {
    const panel = (id: string) => ({ open: true, close: () => { closed.push(id) } })
    useWorkspacePanelDismissals({
      sidebar: panel('sidebar'), chat: panel('chat'), terminal: panel('terminal'),
      agent: panel('agent'), git: panel('git'), android: panel('android'),
      browser: { ...panel('browser'), closeOnBack: () => {
        if (!canGoBack) return true
        navigations++
        return false
      } },
    }, foreground)
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => { root.render(createElement(BrowserBackHarness, { foreground: 'browser', canGoBack: true })); await settle() })
    for (let i = 0; i < 2; i++) await act(async () => { window.dispatchEvent(new window.Event('popstate')); await settle() })
    assert.equal(navigations, 2)
    assert.deepEqual(closed, [])
    await act(async () => { root.render(createElement(BrowserBackHarness, { foreground: 'agent', canGoBack: true })); await settle() })
    await act(async () => { window.dispatchEvent(new window.Event('popstate')); await settle() })
    assert.deepEqual(closed, ['agent'])
    assert.equal(navigations, 2)
    await act(async () => { root.render(createElement(BrowserBackHarness, { foreground: 'browser', canGoBack: true })); await settle() })
    await act(async () => { document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle() })
    assert.deepEqual(closed, ['agent', 'browser'])
    assert.equal(navigations, 2)
  } finally {
    await act(async () => { root.unmount(); await settle() })
    host.remove()
  }
})

test('App 보조 패널은 뒤로가기·Esc로 시각적 맨 위부터 하나씩 닫힌다', async () => {
  const closed: PanelId[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(createElement(Harness, { closed }))
    await settle()
  })

  await act(async () => {
    window.dispatchEvent(new window.Event('popstate'))
    await settle()
  })
  assert.deepEqual(closed, ['android'], '모바일 뒤로가기는 맨 위 Android 패널 하나만 닫는다')

  for (const expected of ['browser', 'terminal', 'agent', 'chat', 'sidebar'] as PanelId[]) {
    await act(async () => {
      document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await settle()
    })
    assert.equal(closed.at(-1), expected)
  }

  assert.deepEqual(closed, ['android', 'browser', 'terminal', 'agent', 'chat', 'sidebar'])
  await act(async () => {
    root.unmount()
    await settle()
  })
  host.remove()
})

test('파일 검색 중 첫 Esc는 검색만 취소하고, 다음 Esc가 사이드바를 닫는다', async () => {
  const closed: string[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(createElement(SidebarSearchHarness, { closed }))
    await settle()
  })

  await act(async () => {
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()
  })
  assert.equal(host.querySelector('span')?.dataset.query, '')
  assert.deepEqual(closed, [], '검색을 취소한 첫 Esc에서 사이드바가 닫히면 안 된다')

  await act(async () => {
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()
  })
  assert.deepEqual(closed, ['sidebar'])

  await act(async () => {
    root.unmount()
    await settle()
  })
  host.remove()
})
