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

const { Editor } = await import('@tiptap/core')
const { TextSelection } = await import('@tiptap/pm/state')
const { serverEditorExtensions } = await import('../serverExtensions.ts')
const { VirtualBlocks, materializeVirtualPosition, virtualBlocksKey } = await import('./virtualBlocks.ts')

function createEditor(virtual: boolean) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      ...serverEditorExtensions(),
      ...(virtual ? [VirtualBlocks.configure({ minBlocks: 2, overscan: 0, initialViewportHeight: 1 })] : []),
    ],
    content: Array.from({ length: 30 }, (_, index) => `문단 ${index} [링크 ${index}](./target-${index}.md)`).join('\n\n'),
  })
}

function linkPlugin(editor: InstanceType<typeof Editor>) {
  return editor.state.plugins.find(plugin => plugin.props.handleDOMEvents?.beforeinput && plugin.props.decorations)!
}

test('가상화된 파일 링크는 표시 블록의 caret widget만 만들고 범위 변경을 반영한다', () => {
  const editor = createEditor(true)
  try {
    const plugin = linkPlugin(editor)
    const initial = plugin.props.decorations!.call(plugin, editor.state)!
    assert.equal(initial.find().length, virtualBlocksKey.getState(editor.state)!.visible.size * 2)
    assert.ok(initial.find().length < 10)
    assert.equal(plugin.props.decorations!.call(plugin, editor.state), initial)
    const pos = editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize
    materializeVirtualPosition(editor.view, pos)
    const shown = plugin.props.decorations!.call(plugin, editor.state)!
    assert.notEqual(shown, initial)
    assert.ok(shown.find().some(decoration => decoration.from > pos))
    assert.equal(editor.view.dom.querySelectorAll('.mew-file-link-caret').length, shown.find().length)
    assert.equal(plugin.props.decorations!.call(plugin, editor.state), shown)
    assert.equal((editor.storage as any).markdown.getMarkdown().includes('\u200b'), false)
  } finally { editor.destroy() }
})

test('화면 밖 파일 링크도 모델 선택을 링크 밖으로 이동하고 표시 범위를 즉시 확장한다', () => {
  const editor = createEditor(true)
  try {
    const pos = editor.state.doc.content.size - editor.state.doc.lastChild!.nodeSize
    const label = '링크 29'
    const start = pos + 1 + '문단 29 '.length
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start + 1)))
    assert.equal(editor.state.selection.head, start + label.length)
    assert.equal((editor.view.nodeDOM(pos) as HTMLElement).hasAttribute('data-mew-virtual-hidden'), false)
    const plugin = linkPlugin(editor)
    assert.ok(plugin.props.decorations!.call(plugin, editor.state)!.find().some(decoration => decoration.from === start))
  } finally { editor.destroy() }
})

test('비가상 파일 링크는 전체 caret 장식을 재사용하고 읽기 전용 삭제는 문서를 바꾸지 않는다', () => {
  const editor = createEditor(false)
  try {
    const plugin = linkPlugin(editor)
    const decorations = plugin.props.decorations!.call(plugin, editor.state)!
    assert.equal(decorations.find().length, 60)
    editor.commands.setTextSelection(2)
    assert.equal(plugin.props.decorations!.call(plugin, editor.state), decorations)
    const last = editor.state.doc.lastChild!
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.setEditable(false)
    assert.equal(plugin.props.handleKeyDown!.call(plugin, editor.view, new win.KeyboardEvent('keydown', { key: 'Backspace' }) as unknown as KeyboardEvent), false)
    assert.equal(editor.state.doc.lastChild, last)
  } finally { editor.destroy() }
})

test('파일 링크 양쪽 caret의 일반 입력은 위젯 대신 Markdown 모델에 기록한다', () => {
  for (const side of [0, 1]) {
    const editor = new Editor({ element: document.createElement('div'), extensions: serverEditorExtensions(), content: '[링크](./target.md)' })
    document.body.append(editor.view.dom)
    try {
      const slot = editor.view.dom.querySelectorAll('.mew-file-link-caret')[side]
      const pos = editor.view.posAtDOM(slot, 0)
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos))
        .setStoredMarks([editor.schema.marks.link.create({ href: './target.md' })]))
      const range = document.createRange()
      range.setStart(slot.firstChild!, 0)
      range.collapse(true)
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
      const input = Object.assign(new win.Event('beforeinput', { cancelable: true }), { inputType: 'insertText', data: 'Z한', isComposing: false })
      const plugin = linkPlugin(editor)
      assert.equal(plugin.props.handleDOMEvents!.beforeinput!.call(plugin, editor.view, input as unknown as Event), true)
      assert.equal(input.defaultPrevented, true)
      assert.equal(editor.state.doc.textContent, side === 0 ? 'Z한링크' : '링크Z한')
      assert.equal(editor.state.selection.head, pos + 2)
      const markdown = (editor.storage as any).markdown.getMarkdown()
      assert.ok(markdown.includes(side === 0 ? 'Z한[링크](./target.md)' : '[링크](./target.md)Z한'))
      assert.doesNotMatch(markdown, /\u200b|mew-file-link-caret/)
    } finally { editor.view.dom.remove(); editor.destroy() }
  }
})

test('파일 링크 caret은 조합 입력과 취소 불가 입력, 모델과 다른 선택, 읽기 전용 입력을 가로채지 않는다', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: serverEditorExtensions(), content: '[링크](./target.md)' })
  document.body.append(editor.view.dom)
  try {
    const slot = editor.view.dom.querySelector('.mew-file-link-caret')!
    const pos = editor.view.posAtDOM(slot, 0)
    const selectSlot = () => {
      const range = document.createRange()
      range.setStart(slot.firstChild!, 0)
      range.collapse(true)
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
    }
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
    selectSlot()
    const plugin = linkPlugin(editor)
    const doc = editor.state.doc
    const expectIgnored = (type: string, composing = false, cancelable = true) => {
      const input = Object.assign(new win.Event('beforeinput', { cancelable }), { inputType: type, data: '한', isComposing: composing })
      assert.equal(plugin.props.handleDOMEvents!.beforeinput!.call(plugin, editor.view, input as unknown as Event), false)
      assert.equal(input.defaultPrevented, false)
      assert.equal(editor.state.doc, doc)
    }
    expectIgnored('insertCompositionText', true)
    expectIgnored('insertText', true)
    expectIgnored('insertText', false, false)
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 2)))
    selectSlot()
    expectIgnored('insertText')
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)))
    editor.setEditable(false)
    selectSlot()
    expectIgnored('insertText')
  } finally { editor.view.dom.remove(); editor.destroy() }
})
