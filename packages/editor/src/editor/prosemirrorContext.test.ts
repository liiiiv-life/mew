import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
for (const key of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver', 'navigator', 'ClipboardEvent']) {
  Object.defineProperty(globalThis, key, { value: (win as unknown as Record<string, unknown>)[key], configurable: true })
}
const { Editor } = await import('@tiptap/core')
const { UndoRedo } = await import('@tiptap/extensions')
const { serverEditorExtensions } = await import('../serverExtensions.ts')
const { prepareProseMirrorContext } = await import('./prosemirrorContext.ts')

function makeEditor(content = 'alpha bravo\n\nsecond paragraph') {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({ element, extensions: [...serverEditorExtensions(), UndoRedo], content })
  editor.view.dom.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON() {} })
  let position = 3
  editor.view.posAtCoords = () => ({ pos: position, inside: 0 })
  return { editor, clickAt: (at: number) => { position = at }, destroy: () => { editor.destroy(); element.remove() } }
}
function clipboard(value: object) { Object.defineProperty(navigator, 'clipboard', { value, configurable: true }) }

test('right-clicking in the selection preserves it, maps it across edits, and copies through the Markdown clipboard serializer', async () => {
  const fixture = makeEditor('**alpha** bravo')
  const { editor } = fixture
  let copied = ''
  clipboard({ writeText: async (text: string) => { copied = text } })
  try {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    fixture.clickAt(3)
    const target = prepareProseMirrorContext(editor, 10, 10)!
    assert.equal(target.hasSelection, true)
    editor.view.dispatch(editor.state.tr.insertText('X', 1))
    editor.commands.setTextSelection(12)
    assert.equal(target.restoreSelection(), true)
    assert.equal(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to), 'alpha')
    assert.equal(await target.copy(), true)
    assert.equal(copied, '**alpha**')
    target.dispose()
    assert.equal(target.restoreSelection(), false)
    assert.equal(target.deleteSelection(), false)
  } finally { fixture.destroy() }
})

test('outside selection becomes a cursor; comment selects that paragraph and select-all remains available readonly', () => {
  const fixture = makeEditor()
  const { editor } = fixture
  try {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    fixture.clickAt(15)
    const target = prepareProseMirrorContext(editor, 10, 10)!
    assert.equal(target.hasSelection, false)
    assert.equal(target.canComment, true)
    assert.equal(editor.state.selection.from, 15)
    assert.equal(target.selectCommentTarget(), true)
    assert.equal(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to), 'second paragraph')
    assert.equal(target.selectAll(), true)
    assert.equal(editor.state.selection.from, 0)
    target.dispose()
    editor.setEditable(false)
    fixture.clickAt(3)
    const readonly = prepareProseMirrorContext(editor, 10, 10)!
    assert.equal(readonly.editable, false)
    assert.equal(readonly.deleteSelection(), false)
    assert.equal(readonly.selectAll(), true)
    readonly.dispose()
  } finally { fixture.destroy() }
})

test('cut removes only after clipboard success and participates in undo', async () => {
  const fixture = makeEditor('alpha bravo')
  const { editor } = fixture
  clipboard({ writeText: async () => {} })
  try {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    const target = prepareProseMirrorContext(editor, 10, 10)!
    assert.equal(await target.cut(), true)
    assert.equal(editor.state.doc.textContent, ' bravo')
    assert.equal(editor.commands.undo(), true)
    assert.equal(editor.state.doc.textContent, 'alpha bravo')
    target.dispose()
  } finally { fixture.destroy() }
})

test('Hotview document margins target the first or last visible text position', () => {
  const fixture = makeEditor('body text\n\n# $Annotations$\n\n1. hidden metadata')
  try {
    fixture.editor.commands.setTextSelection(4)
    const top = prepareProseMirrorContext(fixture.editor, 10, -20)!
    assert.equal(fixture.editor.state.selection.from, 1)
    top.dispose()
    const bottom = prepareProseMirrorContext(fixture.editor, 10, 120)!
    assert.equal(fixture.editor.state.selection.from, 10)
    bottom.dispose()
  } finally { fixture.destroy() }
})

test('disposing a pending cut or paste prevents delayed document changes', async () => {
  const fixture = makeEditor('alpha bravo')
  const { editor } = fixture
  let finishWrite: (() => void) | undefined
  let finishRead: ((text: string) => void) | undefined
  clipboard({ writeText: () => new Promise<void>((resolve) => { finishWrite = resolve }), readText: () => new Promise<string>((resolve) => { finishRead = resolve }) })
  try {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    const cut = prepareProseMirrorContext(editor, 10, 10)!
    const cutResult = cut.cut()
    cut.dispose()
    finishWrite!()
    assert.equal(await cutResult, false)
    assert.equal(editor.state.doc.textContent, 'alpha bravo')
    const paste = prepareProseMirrorContext(editor, 10, 10)!
    const pasteResult = paste.paste()
    paste.dispose()
    finishRead!('replacement')
    assert.equal(await pasteResult, false)
    assert.equal(editor.state.doc.textContent, 'alpha bravo')
  } finally { fixture.destroy() }
})

test('clipboard refusal leaves the selection intact, while paste uses the editor paste route', async () => {
  const fixture = makeEditor('alpha bravo')
  const { editor } = fixture
  try {
    editor.commands.setTextSelection({ from: 1, to: 6 })
    const target = prepareProseMirrorContext(editor, 10, 10)!
    clipboard({ writeText: async () => { throw new Error('denied') } })
    assert.equal(await target.cut(), false)
    assert.equal(editor.state.doc.textContent, 'alpha bravo')
    clipboard({ readText: async () => 'new' })
    assert.equal(await target.paste(), true)
    assert.equal(editor.state.doc.textContent, 'new bravo')
    target.dispose()
  } finally { fixture.destroy() }
})

test('cut aborts when collaborators change selected text while clipboard permission is pending', async () => {
  const fixture = makeEditor('alpha bravo')
  let finish: (() => void) | undefined
  clipboard({ writeText: () => new Promise<void>((resolve) => { finish = resolve }) })
  try {
    fixture.editor.commands.setTextSelection({ from: 1, to: 6 })
    const target = prepareProseMirrorContext(fixture.editor, 10, 10)!
    const result = target.cut()
    fixture.editor.view.dispatch(fixture.editor.state.tr.insertText('X', 3))
    finish!()
    assert.equal(await result, false)
    assert.equal(fixture.editor.state.doc.textContent, 'alXpha bravo')
    target.dispose()
  } finally { fixture.destroy() }
})
