import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
const globals = win as unknown as Record<string, unknown>
for (const name of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver', 'KeyboardEvent', 'navigator']) {
  if (name in globalThis) continue
  try { (globalThis as Record<string, unknown>)[name] = globals[name] }
  catch { Object.defineProperty(globalThis, name, { value: globals[name], configurable: true }) }
}
const { Editor, Node: TiptapNode } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { VirtualBlocks, materializeVirtualPosition, virtualBlockState, virtualBlocksKey } = await import('./virtualBlocks.ts')

function createEditor(count = 300, extra: ConstructorParameters<typeof Editor>[0] = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  return new Editor({
    element: host,
    extensions: [StarterKit.configure({ trailingNode: false }), VirtualBlocks.configure({ minBlocks: 100, overscan: 150, initialViewportHeight: 400 })],
    content: Array.from({ length: count }, (_, i) => `<p>문단 ${i} <strong>강조 내용</strong> 텍스트입니다.</p>`).join(''),
    ...extra,
  })
}

function position(editor: InstanceType<typeof Editor>, index: number) {
  let pos = 0
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize
  return pos
}

function destroy(editor: InstanceType<typeof Editor>) {
  const parent = editor.view.dom.parentElement
  editor.destroy()
  parent?.remove()
}

test('첫 EditorView 구성부터 화면 밖 문단의 인라인 DOM을 만들지 않는다', () => {
  const editor = createEditor()
  try {
    assert.equal(editor.state.doc.childCount, 300)
    assert.equal(editor.view.dom.children.length, 300)
    assert.ok(editor.view.dom.querySelectorAll('[data-mew-virtual-hidden]').length > 270)
    assert.ok(editor.view.dom.querySelectorAll('strong').length < 30)
    assert.ok(editor.view.dom.querySelector('[data-mew-virtual-hidden]')?.childNodes.length === 0)
    assert.deepEqual(virtualBlockState(editor.view), { active: true, total: 300, rendered: virtualBlockState(editor.view).rendered })
  } finally { destroy(editor) }
})

test('짧은 문서는 기존 DOM을 유지한다', () => {
  const editor = createEditor(20)
  try {
    assert.equal(editor.view.dom.querySelectorAll('[data-mew-virtual-hidden]').length, 0)
    assert.equal(editor.view.dom.querySelectorAll('strong').length, 20)
    assert.equal(virtualBlockState(editor.view).active, false)
  } finally { destroy(editor) }
})

test('화면 밖 선택을 즉시 마운트하고 편집·undo가 전체 모델을 보존한다', () => {
  const editor = createEditor()
  try {
    const pos = position(editor, 250)
    assert.equal((editor.view.nodeDOM(pos) as HTMLElement).dataset.mewVirtualHidden, 'true')
    editor.commands.setTextSelection(pos + 1)
    assert.equal((editor.view.nodeDOM(pos) as HTMLElement).tagName, 'P')
    editor.view.dispatch(editor.state.tr.insertText('추가 '))
    assert.ok(editor.state.doc.child(250).textContent.startsWith('추가 '))
    assert.equal(editor.state.doc.childCount, 300)
    editor.commands.undo()
    assert.ok(!editor.state.doc.child(250).textContent.startsWith('추가 '))
    assert.equal(editor.state.doc.child(299).textContent.includes('문단 299'), true)
  } finally { destroy(editor) }
})

test('여러 블록 선택은 전체 선택 구간을 마운트하고 복사 모델을 유지한다', () => {
  const editor = createEditor()
  try {
    editor.commands.setTextSelection({ from: position(editor, 200) + 1, to: position(editor, 215) + 8 })
    for (let index = 200; index <= 215; index++) assert.equal((editor.view.nodeDOM(position(editor, index)) as HTMLElement).tagName, 'P')
    assert.ok(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to).includes('문단 210'))
    assert.ok(editor.view.dom.querySelectorAll('strong').length < 50)
  } finally { destroy(editor) }
})

test('위치 materialize는 선택을 바꾸지 않고 숨겨진 내용을 마운트한다', () => {
  const editor = createEditor()
  try {
    const selection = editor.state.selection
    const pos = position(editor, 250)
    materializeVirtualPosition(editor.view, pos)
    assert.equal(editor.state.selection.eq(selection), true)
    assert.equal((editor.view.nodeDOM(pos) as HTMLElement).tagName, 'P')
  } finally { destroy(editor) }
})

test('스크롤은 새 범위만 마운트하고 이전 범위를 해제하며 선택 블록은 유지한다', async () => {
  const editor = createEditor()
  try {
    const first = editor.view.dom.firstElementChild
    // Happy DOM has no layout: supply the scrolled editor's viewport coordinates.
    editor.view.dom.getBoundingClientRect = () => ({ top: -7000, bottom: 3000, left: 0, right: 768, width: 768, height: 10000, x: 0, y: -7000, toJSON() {} })
    win.dispatchEvent(new win.Event('scroll'))
    await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
    const mounted = Array.from(editor.view.dom.children).filter(child => !child.hasAttribute('data-mew-virtual-hidden'))
    assert.ok(mounted.some(child => child.textContent?.includes('문단 220')))
    assert.equal(editor.view.dom.firstElementChild, first)
    assert.equal((editor.view.nodeDOM(position(editor, 15)) as HTMLElement).dataset.mewVirtualHidden, 'true')
    assert.ok(mounted.length < 50)
  } finally { destroy(editor) }
})

test('기존 custom nodeView는 보이는 블록에서 그대로 쓰고 해제 시 destroy를 호출한다', async () => {
  let constructed = 0, destroyed = 0
  const Custom = TiptapNode.create({
    name: 'customBlock', group: 'block', content: 'inline*',
    parseHTML: () => [{ tag: 'section' }], renderHTML: () => ['section', 0],
    addNodeView() {
      return () => {
        constructed++
        const dom = document.createElement('section')
        dom.dataset.custom = 'true'
        return { dom, contentDOM: dom, destroy: () => { destroyed++ } }
      }
    },
  })
  const editor = createEditor(300, {
    extensions: [StarterKit.configure({ trailingNode: false }), Custom, VirtualBlocks.configure({ minBlocks: 100, overscan: 100, initialViewportHeight: 300 })],
    content: Array.from({ length: 300 }, (_, i) => `<section>custom ${i}</section>`).join(''),
  })
  try {
    assert.ok(constructed < 10)
    const before = constructed
    materializeVirtualPosition(editor.view, position(editor, 200))
    assert.equal((editor.view.nodeDOM(position(editor, 200)) as HTMLElement).dataset.custom, 'true')
    assert.equal(constructed, before + 1)
  } finally { destroy(editor) }
  assert.equal(destroyed, constructed)
  await new Promise(resolve => win.requestAnimationFrame(resolve))
})

test('중첩 목록은 보이는 상태에서 기존 contentDOM과 checkbox nodeView를 유지한다', () => {
  const editor = createEditor(300, { content: '<ul><li><p>목록</p><ul><li><p>중첩</p></li></ul></li></ul>' + '<p>본문</p>'.repeat(299) })
  try {
    assert.equal(editor.view.dom.querySelectorAll('li').length, 2)
    assert.equal(editor.view.dom.querySelector('li li')?.textContent, '중첩')
  } finally { destroy(editor) }
})

test('detach 이후 실제 스크롤 조상으로 이동해도 새 화면 범위를 갱신한다', async () => {
  const editor = createEditor()
  const scroller = document.createElement('div')
  scroller.style.overflowY = 'auto'
  document.body.append(scroller)
  scroller.append(editor.view.dom)
  try {
    editor.view.dom.getBoundingClientRect = () => ({ top: -7000, bottom: 3000, left: 0, right: 768, width: 768, height: 10000, x: 0, y: -7000, toJSON() {} })
    scroller.dispatchEvent(new win.Event('scroll'))
    await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
    assert.ok(Array.from(editor.view.dom.querySelectorAll('p')).some(el => el.textContent?.includes('문단 220')))
  } finally { destroy(editor); scroller.remove() }
})

test('destroy 후 scroll·resize가 RAF나 플러그인 dispatch를 다시 등록하지 않는다', async () => {
  const editor = createEditor()
  const dom = editor.view.dom
  destroy(editor)
  const original = win.requestAnimationFrame.bind(win)
  let calls = 0
  win.requestAnimationFrame = callback => { calls++; return original(callback) }
  try {
    win.dispatchEvent(new win.Event('scroll'))
    win.dispatchEvent(new win.Event('resize'))
    dom.dispatchEvent(new win.CompositionEvent('compositionend'))
    await new Promise(resolve => original(resolve))
    assert.equal(calls, 0)
  } finally { win.requestAnimationFrame = original }
})

test('IME 입력으로 노드 identity가 바뀌고 선택이 이동해도 composition 블록을 유지한다', async () => {
  const editor = createEditor()
  try {
    editor.commands.setTextSelection(position(editor, 250) + 1)
    editor.view.dom.dispatchEvent(new win.CompositionEvent('compositionstart'))
    editor.view.dispatch(editor.state.tr.insertText('한글'))
    editor.commands.setTextSelection(1)
    const composingPos = position(editor, 250)
    assert.equal((editor.view.nodeDOM(composingPos) as HTMLElement).tagName, 'P')
    assert.ok(editor.state.doc.child(250).textContent.startsWith('한글'))
    editor.view.dom.dispatchEvent(new win.CompositionEvent('compositionend'))
    await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
    assert.equal((editor.view.nodeDOM(composingPos) as HTMLElement).dataset.mewVirtualHidden, 'true')
  } finally { destroy(editor) }
})

test('작은 문서는 native nodeViews를 쓰고 임계값을 넘거나 다시 줄이면 map을 교체한다', () => {
  const editor = createEditor(20)
  try {
    assert.equal(editor.view.props.nodeViews?.paragraph, undefined)
    editor.commands.setContent('<p>긴 문서</p>'.repeat(130))
    assert.equal(typeof editor.view.props.nodeViews?.paragraph, 'function')
    assert.ok(editor.view.dom.querySelectorAll('[data-mew-virtual-hidden]').length > 90)
    editor.commands.setContent('<p>작은 문서</p>'.repeat(20))
    assert.equal(editor.view.props.nodeViews?.paragraph, undefined)
    assert.equal(editor.view.dom.querySelectorAll('[data-mew-virtual-hidden]').length, 0)
  } finally { destroy(editor) }
})

test('plugin nodeViews로 등록한 resizable table의 wrapper와 nested table을 유지한다', async () => {
  const { TableKit } = await import('@tiptap/extension-table')
  const table = '<table><tbody><tr><td><p>표 내용</p></td></tr></tbody></table>'
  for (const count of [20, 300]) {
    const editor = createEditor(count, {
      extensions: [StarterKit.configure({ trailingNode: false }), TableKit.configure({ table: { resizable: true } }), VirtualBlocks.configure({ minBlocks: 100, overscan: 150, initialViewportHeight: 400 })],
      content: table + `<blockquote>${table}</blockquote>` + '<p>본문</p>'.repeat(count - 2),
    })
    try {
      assert.equal(editor.view.dom.querySelectorAll('.tableWrapper').length, 2, `${count} blocks preserve plugin table views`)
      assert.equal(editor.view.dom.querySelectorAll('.tableWrapper colgroup').length, 2)
      editor.commands.setTextSelection(4)
      editor.view.dispatch(editor.state.tr.insertText('추가'))
      assert.equal(editor.view.dom.querySelectorAll('.tableWrapper').length, 2)
    } finally { destroy(editor) }
  }
})

test('작은 문서의 초기 mount와 편집은 가상화 RAF/meta 트랜잭션을 추가하지 않는다', async () => {
  let transactions = 0
  const editor = createEditor(20, { onTransaction() { transactions++ } })
  try {
    await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
    assert.equal(transactions, 0)
    materializeVirtualPosition(editor.view, 1)
    assert.equal(transactions, 0)
    editor.view.dispatch(editor.state.tr.insertText('추가'))
    assert.equal(transactions, 1)
    await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
    assert.equal(transactions, 1)
  } finally { destroy(editor) }
})

test('PM 선택과 별개인 nodeView input의 포커스와 로컬 초안을 화면 밖에서도 유지한다', async () => {
  const DraftBlock = TiptapNode.create({
    name: 'draftBlock', group: 'block', atom: true,
    parseHTML: () => [{ tag: 'section' }], renderHTML: () => ['section'],
    addNodeView() {
      return () => {
        const dom = document.createElement('section')
        const input = document.createElement('input')
        input.value = '저장 전 초안'
        dom.append(input)
        return { dom, stopEvent: () => true }
      }
    },
  })
  const editor = createEditor(300, {
    extensions: [StarterKit.configure({ trailingNode: false }), DraftBlock, VirtualBlocks.configure({ minBlocks: 100, overscan: 150, initialViewportHeight: 400 })],
    content: '<p>본문</p>'.repeat(250) + '<section></section>' + '<p>본문</p>'.repeat(49),
  })
  const outside = document.createElement('button')
  document.body.append(outside)
  try {
    const shared = editor.state.doc.child(250)
    editor.view.dispatch(editor.state.tr.replaceWith(position(editor, 290), position(editor, 291), shared))
    assert.equal(editor.state.doc.child(250), editor.state.doc.child(290))
    const targetPos = position(editor, 250)
    materializeVirtualPosition(editor.view, targetPos)
    const input = (editor.view.nodeDOM(targetPos) as HTMLElement).querySelector('input')!
    input.focus()
    input.value = '수정한 로컬 초안'
    assert.equal(editor.state.selection.head, 1)
    await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
    win.dispatchEvent(new win.Event('scroll'))
    await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
    assert.equal(input.isConnected, true)
    assert.equal(document.activeElement, input)
    assert.equal(input.value, '수정한 로컬 초안')
    assert.equal((editor.view.nodeDOM(position(editor, 290)) as HTMLElement).dataset.mewVirtualHidden, 'true', 'duplicate node identity does not pin another input')
    // An edit before the focused block must map the pin rather than pinning its old offset.
    editor.view.dispatch(editor.state.tr.insertText('이전 입력', 1))
    assert.equal(input.isConnected, true)
    assert.equal(document.activeElement, input)
    outside.focus()
    await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
    assert.equal(input.isConnected, false)
  } finally { destroy(editor); outside.remove() }
})

test('재생 중인 audio/video는 화면 밖에서도 같은 DOM을 유지하고 정지하면 해제한다', async () => {
  for (const tag of ['audio', 'video']) {
    const MediaBlock = TiptapNode.create({
      name: 'mediaBlock', group: 'block', atom: true,
      parseHTML: () => [{ tag: 'section' }], renderHTML: () => ['section'],
      addNodeView() {
        return () => {
          const dom = document.createElement('section')
          dom.append(document.createElement(tag))
          return { dom }
        }
      },
    })
    const editor = createEditor(300, {
      extensions: [StarterKit.configure({ trailingNode: false }), MediaBlock, VirtualBlocks.configure({ minBlocks: 100, overscan: 150, initialViewportHeight: 400 })],
      content: '<p>본문</p>'.repeat(250) + '<section></section>' + '<p>본문</p>'.repeat(49),
    })
    try {
      const targetPos = position(editor, 250)
      materializeVirtualPosition(editor.view, targetPos)
      const media = (editor.view.nodeDOM(targetPos) as HTMLElement).querySelector(tag)!
      media.dispatchEvent(new win.Event('play'))
      await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
      win.dispatchEvent(new win.Event('scroll'))
      await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
      assert.equal(media.isConnected, true)
      assert.equal(editor.state.selection.head, 1)
      editor.view.dispatch(editor.state.tr.insertText('이전 입력', 1))
      assert.equal(media.isConnected, true)
      media.dispatchEvent(new win.Event(tag === 'audio' ? 'pause' : 'ended'))
      await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
      assert.equal(media.isConnected, false)
    } finally { destroy(editor) }
  }
})

test('같은 PMNode를 공유한 복사본도 요청한 위치만 마운트하고 DOM 위치를 구분한다', () => {
  const editor = createEditor()
  try {
    const shared = editor.state.doc.child(180)
    editor.view.dispatch(editor.state.tr.replaceWith(position(editor, 250), position(editor, 251), shared))
    assert.equal(editor.state.doc.child(180), editor.state.doc.child(250), 'native drag-copy can reuse the same immutable node')
    const firstPos = position(editor, 180)
    const secondPos = position(editor, 250)
    const selection = editor.state.selection
    assert.equal((editor.view.nodeDOM(firstPos) as HTMLElement).dataset.mewVirtualHidden, 'true')
    assert.equal((editor.view.nodeDOM(secondPos) as HTMLElement).dataset.mewVirtualHidden, 'true')

    materializeVirtualPosition(editor.view, firstPos)
    const firstSnapshot = virtualBlocksKey.getState(editor.state)!
    assert.equal(firstSnapshot.visible.has(firstPos), true)
    assert.equal(firstSnapshot.visible.has(secondPos), false, 'forcing first copy must not resolve to the last node identity')
    assert.equal(firstSnapshot.blocks[180].pos, firstPos)
    assert.equal(firstSnapshot.blocks[250].pos, secondPos)
    assert.equal(firstSnapshot.blocks[180].node, firstSnapshot.blocks[250].node)
    const firstDom = editor.view.nodeDOM(firstPos) as HTMLElement
    assert.equal(firstDom.tagName, 'P')
    assert.equal(editor.view.posAtDOM(firstDom, 0), firstPos + 1)
    assert.equal((editor.view.nodeDOM(secondPos) as HTMLElement).dataset.mewVirtualHidden, 'true')
    assert.ok(editor.state.selection.eq(selection))

    materializeVirtualPosition(editor.view, firstPos)
    const repeated = virtualBlocksKey.getState(editor.state)!
    assert.equal(repeated.blocks, firstSnapshot.blocks, 'same document reuses the block index')
    assert.equal(repeated.decorations, firstSnapshot.decorations, 'same visible positions reuse decorations')
    assert.equal(editor.view.nodeDOM(firstPos), firstDom)

    materializeVirtualPosition(editor.view, secondPos)
    const secondSnapshot = virtualBlocksKey.getState(editor.state)!
    assert.equal(secondSnapshot.visible.has(firstPos), true)
    assert.equal(secondSnapshot.visible.has(secondPos), true)
    const secondDom = editor.view.nodeDOM(secondPos) as HTMLElement
    assert.equal(secondDom.tagName, 'P')
    assert.notEqual(secondDom, firstDom)
    assert.equal(editor.view.posAtDOM(secondDom, 0), secondPos + 1)
    assert.equal(editor.view.nodeDOM(firstPos), firstDom)
    assert.ok(editor.state.selection.eq(selection))
    assert.equal(editor.state.doc.childCount, 300)
    editor.view.dispatch(editor.state.tr.insertText('앞쪽 ', 1))
    const shiftedFirst = position(editor, 180)
    const shiftedSecond = position(editor, 250)
    assert.equal(editor.view.nodeDOM(shiftedFirst), firstDom)
    assert.equal(editor.view.nodeDOM(shiftedSecond), secondDom)
    assert.equal(editor.view.posAtDOM(firstDom, 0), shiftedFirst + 1)
    assert.equal(editor.view.posAtDOM(secondDom, 0), shiftedSecond + 1)
    const shifted = virtualBlocksKey.getState(editor.state)!
    assert.ok(shifted.visible.has(shiftedFirst))
    assert.ok(shifted.visible.has(shiftedSecond))
    assert.equal(shifted.blocks[180].node, shifted.blocks[250].node)
  } finally { destroy(editor) }
})
