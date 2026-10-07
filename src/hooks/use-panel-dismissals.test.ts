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

const ids = ['sidebar', 'chat', 'agent', 'terminal', 'browser', 'git', 'android', 'features', 'memo', 'tasks', 'debugger'] as const
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
    git: panel('git'),
    features: panel('features'), memo: panel('memo'), tasks: panel('tasks'), debugger: panel('debugger'),
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
      onEscape: () => { setQuery('') },
    },
    chat: closedPanel,
    agent: closedPanel,
    terminal: closedPanel,
    browser: closedPanel,
    android: closedPanel,
    git: closedPanel,
    features: closedPanel, memo: closedPanel, tasks: closedPanel, debugger: closedPanel,
  }, 'sidebar')
  return createElement('span', { 'data-query': query })
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('only the foreground browser delegates Back; Escape keeps panels open', async () => {
  const closed: string[] = []
  let navigations = 0
  function BrowserBackHarness({ foreground, canGoBack }: { foreground: 'browser' | 'agent'; canGoBack: boolean }) {
    const panel = (id: string) => ({ open: true, close: () => { closed.push(id) } })
    useWorkspacePanelDismissals({
      sidebar: panel('sidebar'), chat: panel('chat'), terminal: panel('terminal'),
      agent: panel('agent'), git: panel('git'), android: panel('android'), features: panel('features'),
      memo: panel('memo'), tasks: panel('tasks'), debugger: panel('debugger'),
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
    assert.deepEqual(closed, ['agent'])
    assert.equal(navigations, 2)
  } finally {
    await act(async () => { root.unmount(); await settle() })
    host.remove()
  }
})

test('모든 App 패널은 Esc로 유지되고 모바일 뒤로가기로만 하나씩 닫힌다', async () => {
  const closed: PanelId[] = []
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(createElement(Harness, { closed }))
    await settle()
  })

  for (const expected of [...ids].reverse()) {
    for (let i = 0; i < 2; i++) {
      const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      await act(async () => { document.body.dispatchEvent(event); await settle() })
      assert.equal(event.defaultPrevented, false, '콘텐츠가 Esc를 계속 받을 수 있어야 한다')
    }
    assert.equal(closed.includes(expected), false, `${expected} 패널은 Esc로 닫히지 않는다`)
    await act(async () => { window.dispatchEvent(new window.Event('popstate')); await settle() })
    assert.equal(closed.at(-1), expected, '뒤로가기는 전면 패널 하나만 닫는다')
  }
  assert.deepEqual(closed, [...ids].reverse())
  await act(async () => {
    root.unmount()
    await settle()
  })
  host.remove()
})

test('Esc는 파일 검색만 취소하고 반복해도 사이드바를 유지한다', async () => {
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
  assert.deepEqual(closed, [])

  await act(async () => {
    root.unmount()
    await settle()
  })
  host.remove()
})

test('mobile Back restores repeated panel visits and editor, capped at 20 entries', async () => {
  type Foreground = import('../utils/mobile-panel-stack.ts').MobileForeground
  let select: (panel: Foreground) => void = () => {}
  let shown: Foreground = 'editor'
  function NavigationHarness({ scope = 'project' }: { scope?: string }) {
    const [current, setCurrent] = useState<Foreground>('editor')
    select = setCurrent
    shown = current
    const panels = Object.fromEntries(
      [...ids, 'memo', 'tasks'].map(id => [id, { open: true, close: () => setCurrent('editor') }]),
    ) as import('./use-panel-dismissals.ts').WorkspacePanelDismissals
    useWorkspacePanelDismissals(panels, current === 'editor' ? null : current, {
      enabled: true, scope, show: setCurrent,
    })
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const back = async () => act(async () => { window.dispatchEvent(new window.Event('popstate')); await settle() })
  const visit = async (panel: Foreground) => act(async () => { select(panel); await settle() })
  try {
    await act(async () => { root.render(createElement(NavigationHarness)); await settle() })
    for (const panel of ['agent', 'git', 'agent', 'editor'] as const) await visit(panel)
    for (const expected of ['agent', 'git', 'agent', 'editor']) {
      await back()
      assert.equal(shown, expected)
    }
    for (let i = 0; i < 25; i++) await visit(i % 2 ? 'editor' : 'agent')
    await visit('agent') // same selection does not add history
    for (let i = 0; i < 20; i++) {
      await back()
      assert.equal(shown, i % 2 ? 'agent' : 'editor')
    }
    await back() // exhausted history falls back to closing the panel
    assert.equal(shown, 'editor')
    await visit('git')
    await act(async () => { root.render(createElement(NavigationHarness, { scope: 'other-project' })); await settle() })
    await back()
    assert.equal(shown, 'editor', 'project switch clears navigation history')
  } finally {
    await act(async () => { root.unmount(); await settle() })
    host.remove()
  }
})

test('navigation restores panel screens across editor visits without recording restoration or hidden screen changes', async () => {
  type Foreground = import('../utils/mobile-panel-stack.ts').MobileForeground
  type Screen = 'graph' | 'commit:abc' | 'diff:working:a.ts' | 'diff:working:b.ts' | 'diff:abc:a.ts'
  let visit: (panel: Foreground) => void = () => {}
  let changeScreen: (screen: Screen) => void = () => {}
  let goBack: () => boolean = () => false
  let shown: Foreground = 'editor', screen: Screen = 'graph'
  function NavigationHarness({ scope = 'project', enabled = true }: { scope?: string; enabled?: boolean }) {
    const [current, setCurrent] = useState<Foreground>('editor')
    const [currentScreen, setScreen] = useState<Screen>('graph')
    visit = setCurrent
    changeScreen = setScreen
    shown = current
    screen = currentScreen
    const panels = Object.fromEntries(
      [...ids, 'memo', 'tasks'].map(id => [id, { open: true, close: () => setCurrent('editor') }]),
    ) as import('./use-panel-dismissals.ts').WorkspacePanelDismissals
    goBack = useWorkspacePanelDismissals(panels, current === 'editor' ? null : current, {
      enabled, scope, show: setCurrent,
      screens: { git: { key: currentScreen, restore: () => setScreen(currentScreen) } },
    })
    return null
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const back = async () => act(async () => { window.dispatchEvent(new window.Event('popstate')); await settle() })
  const select = async (panel: Foreground, target?: Screen) => act(async () => {
    visit(panel)
    if (target) changeScreen(target)
    await settle()
  })
  try {
    await act(async () => { root.render(createElement(NavigationHarness)); await settle() })
    await select('git')
    await select('git', 'diff:working:a.ts')
    await select('editor')
    await select('editor', 'diff:working:b.ts') // hidden Git changes do not alter the saved visit
    await back()
    assert.equal(shown, 'git')
    assert.equal(screen, 'diff:working:a.ts')
    await back()
    assert.equal(screen, 'graph')
    assert.equal(shown, 'git')
    await back()
    assert.equal(shown, 'editor')
    assert.equal(goBack(), false, 'restoring the screen did not append a new visit')

    await select('git', 'graph')
    await select('git', 'commit:abc')
    await select('git', 'diff:abc:a.ts')
    await select('editor')
    await back()
    assert.equal(screen, 'diff:abc:a.ts')
    await back()
    assert.equal(screen, 'commit:abc')
    await act(async () => { assert.equal(goBack(), true); await settle() }) // toolbar Back uses the same navigator
    assert.equal(screen, 'graph')
    await back()
    assert.equal(shown, 'editor')

    await select('git', 'diff:working:a.ts')
    await select('git', 'diff:working:b.ts')
    await select('git', 'diff:working:b.ts') // repeated screen selection creates no visit
    await back()
    assert.equal(screen, 'diff:working:a.ts')
    await act(async () => { root.render(createElement(NavigationHarness, { enabled: false })); await settle() })
    assert.equal(goBack(), false, 'desktop mode clears the mobile navigator')
    await act(async () => { root.render(createElement(NavigationHarness)); await settle() })
    assert.equal(goBack(), false)
    await select('editor')
    await act(async () => { root.render(createElement(NavigationHarness, { scope: 'other-project' })); await settle() })
    assert.equal(goBack(), false, 'project switch discards screen restore callbacks too')
  } finally {
    await act(async () => { root.unmount(); await settle() })
    host.remove()
  }
})
