import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
const globals = win as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver']) {
  if (!(key in globalThis)) Object.defineProperty(globalThis, key, { value: globals[key], configurable: true })
}
const { Editor } = await import('@tiptap/core')
const { UndoRedo } = await import('@tiptap/extensions')
const { serverEditorExtensions } = await import('../serverExtensions.ts')
const { Annotations, scanAnnotations, insertAnnotation, updateAnnotation, deleteAnnotation } = await import('./annotations.ts')

function makeEditor(content = '본문', options: { onOpen?: (num: number, x: number, y: number) => void; editable?: boolean } = {}) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), UndoRedo, Annotations.configure({ onOpen: options.onOpen ?? (() => {}) })],
    content,
    editable: options.editable ?? true,
  })
}
function markdown(editor: InstanceType<typeof Editor>): string {
  return (editor.storage as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
}
function scan(editor: InstanceType<typeof Editor>) { return scanAnnotations(editor.state.doc) }
const source = '가^[1] 나^[2] 다^[3]\n\n# $Annotations$\n\n1. 첫째\n2. **둘째**\n3. [셋째](https://example.com)'

test('cursor or selection insertion preserves text and creates a hidden serializable section', () => {
  const editor = makeEditor('선택한 문장')
  try {
    editor.commands.setTextSelection({ from: 1, to: 4 })
    assert.equal(insertAnnotation(editor), 1)
    assert.equal(editor.state.doc.firstChild?.textContent, '선택한1 문장')
    assert.deepEqual(scan(editor).markers.map((marker) => marker.num), [1])
    assert.equal(editor.state.doc.firstChild?.child(1).marks[0].type.name, 'annotationMarker')
    assert.equal(editor.state.selection.from, 5)
    assert.match(markdown(editor), /선택한\^\[1\] 문장/)
    assert.match(markdown(editor), /^# \$Annotations\$$/m)
    const marker = editor.view.dom.querySelector('sup[data-annotation-number="1"]')
    assert.equal(marker?.textContent, '1')
    assert.ok(editor.view.dom.querySelectorAll('.mew-annotation-section').length >= 2)
    assert.equal(editor.view.dom.querySelector('.mew-annotation-section')?.getAttribute('aria-hidden'), 'true')
  } finally { editor.destroy() }
})

test('inserting before existing markers keeps their rich entry content and renumbers them', () => {
  const editor = makeEditor(source)
  try {
    editor.commands.setTextSelection(1)
    assert.equal(insertAnnotation(editor), 1)
    assert.deepEqual(scan(editor).markers.map((marker) => marker.num), [1, 2, 3, 4])
    assert.deepEqual(scan(editor).entries.map((entry) => entry.content), ['', '첫째', '둘째', '셋째'])
    assert.match(markdown(editor), /3\. \*\*둘째\*\*/)
    assert.match(markdown(editor), /4\. \[셋째\]\(https:\/\/example.com\)/)
    assert.equal(updateAnnotation(editor, 1, '<b>문자 그대로</b>\n둘째 줄'), true)
    assert.equal(scan(editor).entries[0].content, '<b>문자 그대로</b>\n둘째 줄')
    const item = editor.state.doc.nodeAt(scan(editor).entries[0].pos)
    assert.equal(item?.childCount, 2)
    assert.equal(item?.firstChild?.firstChild?.marks.length, 0)
  } finally { editor.destroy() }
})

test('deleting a marker through normal editing removes its entry and retains later rich content', () => {
  const editor = makeEditor(source)
  try {
    const marker = scan(editor).markers[1]
    editor.view.dispatch(editor.state.tr.delete(marker.from, marker.to))
    assert.deepEqual(scan(editor).markers.map((marker) => marker.num), [1, 2])
    assert.deepEqual(scan(editor).entries.map((entry) => entry.content), ['첫째', '셋째'])
    assert.match(markdown(editor), /2\. \[셋째\]\(https:\/\/example.com\)/)
    assert.equal(deleteAnnotation(editor, 1), true)
    assert.deepEqual(scan(editor).entries.map((entry) => entry.content), ['셋째'])
    assert.equal(deleteAnnotation(editor, 1), true)
    assert.equal(scan(editor).sectionFrom, Infinity)
    assert.doesNotMatch(markdown(editor), /\$Annotations\$/)
  } finally { editor.destroy() }
})

test('native deletion of the last marker removes the reserved heading and list together', () => {
  const editor = makeEditor('본문^[1]\n\n# $Annotations$\n\n1. 내용')
  try {
    const marker = scan(editor).markers[0]
    editor.view.dispatch(editor.state.tr.delete(marker.from, marker.to))
    assert.equal(scan(editor).sectionFrom, Infinity)
    assert.equal(markdown(editor).trim(), '본문')
    assert.equal(editor.commands.undo(), true)
    assert.equal(scan(editor).entries[0].content, '내용')
  } finally { editor.destroy() }
})

test('one undo removes insertion and its generated section, and redo restores both', () => {
  const editor = makeEditor('본문')
  try {
    const before = editor.state.doc.toJSON()
    editor.commands.setTextSelection(3)
    insertAnnotation(editor)
    assert.equal(updateAnnotation(editor, 1, ''), true)
    assert.equal(editor.commands.undo(), true)
    assert.deepEqual(editor.state.doc.toJSON(), before)
    assert.equal(editor.commands.redo(), true)
    assert.equal(scan(editor).markers.length, 1)
    assert.equal(scan(editor).entries.length, 1)
  } finally { editor.destroy() }
})

test('pasting an adjacent copy gives it a separate identity and copies the annotation content', async () => {
  const { Fragment, Slice } = await import('@tiptap/pm/model')
  const editor = makeEditor('가^[1] 나^[2]\n\n# $Annotations$\n\n1. 첫째\n2. 둘째')
  try {
    const marker = scan(editor).markers[0]
    let pasted = new Slice(Fragment.from(editor.state.doc.nodeAt(marker.from)!), 0, 0)
    editor.view.someProp('transformPasted', (transform) => { pasted = transform(pasted, editor.view, false); return false })
    editor.view.dispatch(editor.state.tr.insert(marker.to, pasted.content))
    assert.deepEqual(scan(editor).markers.map((item) => item.num), [1, 2, 3])
    assert.deepEqual(scan(editor).entries.map((item) => item.content), ['첫째', '첫째', '둘째'])
    assert.notEqual(scan(editor).markers[0].id, scan(editor).markers[1].id)
  } finally { editor.destroy() }
})

test('unmatched manually authored entries are preserved and can be deleted explicitly', () => {
  const editor = makeEditor('본문^[1]\n\n# $Annotations$\n\n1. 연결됨\n2. 수동 항목')
  try {
    assert.equal(deleteAnnotation(editor, 1), true)
    assert.deepEqual(scan(editor).entries.map((item) => item.content), ['수동 항목'])
    editor.view.dispatch(editor.state.tr.insertText('!', 1))
    assert.equal(scan(editor).entries[0].content, '수동 항목')
    assert.equal(deleteAnnotation(editor, 1), true)
    assert.equal(scan(editor).sectionFrom, Infinity)
  } finally { editor.destroy() }
})

test('Markdown round trips preserve markers while escaped markers and code stay literal', () => {
  const editor = makeEditor('본문^[1] `코드^[2]` \\^[3]\n\n```md\n코드^[4]\n```\n\n# $Annotations$\n\n1. 내용')
  try {
    assert.equal(scan(editor).markers.length, 1)
    const first = markdown(editor)
    editor.commands.setContent(first)
    assert.equal(scan(editor).markers.length, 1)
    assert.equal(markdown(editor).trim(), first.trim())
    assert.match(first, /`코드\^\[2\]`/)
    assert.match(first, /```md\n코드\^\[4\]/)
  } finally { editor.destroy() }
})

test('Ctrl+quote inserts and opens the annotation; clicking its superscript opens the same field', () => {
  const opened: number[] = []
  const editor = makeEditor('본문', { onOpen: (num) => opened.push(num) })
  try {
    editor.view.coordsAtPos = () => ({ left: 10, right: 10, top: 20, bottom: 30 })
    const handled = editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, new window.KeyboardEvent('keydown', { key: "'", code: 'Quote', ctrlKey: true }) as unknown as KeyboardEvent))
    assert.equal(handled, true)
    assert.deepEqual(opened, [1])
    const marker = editor.view.dom.querySelector('sup')!
    const event = new window.MouseEvent('click', { bubbles: true }) as unknown as MouseEvent
    Object.defineProperty(event, 'target', { value: marker })
    editor.view.someProp('handleClick', (handler) => handler(editor.view, 1, event))
    assert.deepEqual(opened, [1, 1])
  } finally { editor.destroy() }
})

test('read-only documents and code contexts reject insertion, edits, and deletion', () => {
  const editor = makeEditor('본문^[1]\n\n# $Annotations$\n\n1. 내용', { editable: false })
  try {
    const before = markdown(editor)
    assert.equal(insertAnnotation(editor), null)
    assert.equal(updateAnnotation(editor, 1, '변경'), false)
    assert.equal(deleteAnnotation(editor, 1), false)
    assert.equal(markdown(editor), before)
  } finally { editor.destroy() }
  const code = makeEditor('```md\n본문\n```')
  try { assert.equal(insertAnnotation(code), null) } finally { code.destroy() }
})

test('the hidden section rejects caret movement and annotations are excluded from scanning their own text', () => {
  const editor = makeEditor('본문^[1]\n\n# $Annotations$\n\n1. 내용^[99]')
  try {
    assert.equal(scan(editor).markers.length, 1)
    const section = scan(editor)
    editor.commands.setTextSelection(section.entries[0].pos + 2)
    assert.ok(editor.state.selection.to < section.sectionFrom)
  } finally { editor.destroy() }
})

test('select all covers the visible body and deleting it also removes linked annotations', () => {
  const editor = makeEditor(source)
  try {
    editor.commands.selectAll()
    assert.equal(editor.state.selection.from, 1)
    assert.ok(editor.state.selection.to < scan(editor).sectionFrom)
    editor.commands.deleteSelection()
    assert.equal(scan(editor).markers.length, 0)
    assert.equal(scan(editor).entries.length, 0)
    assert.equal(scan(editor).sectionFrom, Infinity)
    assert.equal(markdown(editor).trim(), '')
  } finally { editor.destroy() }
})

test('loading a different manually authored section preserves its unmatched entry', () => {
  const editor = makeEditor('본문^[1]\n\n# $Annotations$\n\n1. 원래 주석')
  try {
    editor.commands.setContent('새 본문\n\n# $Annotations$\n\n1. 수동 작성')
    assert.deepEqual(scan(editor).entries.map((entry) => entry.content), ['수동 작성'])
  } finally { editor.destroy() }
})

test('a superscript is keyboard accessible, and modified or composing quote keystrokes are ignored', () => {
  const opened: number[] = []
  const editor = makeEditor('본문^[1]\n\n# $Annotations$\n\n1. 내용', { onOpen: (num) => opened.push(num) })
  try {
    const marker = editor.view.dom.querySelector('sup')!
    assert.equal(marker.getAttribute('tabindex'), '0')
    assert.equal(marker.getAttribute('role'), 'button')
    const event = new window.KeyboardEvent('keydown', { key: 'Enter' }) as unknown as KeyboardEvent
    Object.defineProperty(event, 'target', { value: marker })
    editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, event))
    assert.deepEqual(opened, [1])
    for (const properties of [{ shiftKey: true }, { isComposing: true }, { repeat: true }]) {
      const quote = new window.KeyboardEvent('keydown', { key: "'", code: 'Quote', ctrlKey: true, ...properties }) as unknown as KeyboardEvent
      editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, quote))
    }
    assert.equal(scan(editor).markers.length, 1)
  } finally { editor.destroy() }
})

test('collaboration undo and redo keep the marker and its section in the same Yjs change', async () => {
  const { Collaboration } = await import('@tiptap/extension-collaboration')
  const { yUndoPluginKey } = await import('@tiptap/y-tiptap')
  const Y = await import('yjs')
  const ydoc = new Y.Doc()
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), Collaboration.configure({ document: ydoc }), Annotations],
    content: '협업 본문',
  })
  try {
    const before = editor.state.doc.toJSON()
    yUndoPluginKey.getState(editor.state).undoManager.clear()
    editor.commands.setTextSelection(4)
    assert.equal(insertAnnotation(editor), 1)
    assert.equal(scan(editor).entries.length, 1)
    assert.equal(editor.commands.undo(), true)
    assert.deepEqual(editor.state.doc.toJSON(), before)
    assert.equal(editor.commands.redo(), true)
    assert.deepEqual(scan(editor).markers.map((marker) => marker.num), [1])
    assert.equal(scan(editor).entries.length, 1)
  } finally { editor.destroy(); ydoc.destroy() }
})

test('offline concurrent insertions retain both identities and notes after repeated Yjs exchanges', async () => {
  const { Collaboration } = await import('@tiptap/extension-collaboration')
  const { prosemirrorToYDoc } = await import('@tiptap/y-tiptap')
  const Y = await import('yjs')
  const initial = makeEditor('ABCDEF')
  const docA = prosemirrorToYDoc(initial.state.doc, 'default')
  initial.destroy()
  const docB = new Y.Doc()
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))
  const create = (document: InstanceType<typeof Y.Doc>) => new Editor({
    element: window.document.createElement('div') as unknown as HTMLElement,
    extensions: [...serverEditorExtensions(), Collaboration.configure({ document }), Annotations],
    content: '',
  })
  const a = create(docA)
  const b = create(docB)
  try {
    assert.equal(a.state.doc.firstChild?.textContent, 'ABCDEF')
    assert.equal(b.state.doc.firstChild?.textContent, 'ABCDEF')
    a.commands.setTextSelection(2)
    assert.equal(insertAnnotation(a), 1)
    assert.equal(updateAnnotation(a, 1, 'A note'), true)
    b.commands.setTextSelection(5)
    assert.equal(insertAnnotation(b), 1)
    assert.equal(updateAnnotation(b, 1, 'B note'), true)
    const idA = scan(a).markers[0].id
    const idB = scan(b).markers[0].id
    assert.ok(idA && idB && idA !== idB)
    for (let round = 0; round < 5; round++) {
      const updateA = Y.encodeStateAsUpdate(docA, Y.encodeStateVector(docB))
      const updateB = Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA))
      Y.applyUpdate(docA, updateB)
      Y.applyUpdate(docB, updateA)
    }
    assert.deepEqual(a.getJSON(), b.getJSON())
    for (const editor of [a, b]) {
      let body = ''
      editor.state.doc.firstChild?.descendants((node) => { if (node.isText && !node.marks.some((mark) => mark.type.name === 'annotationMarker')) body += node.text })
      assert.equal(body, 'ABCDEF')
      assert.deepEqual(scan(editor).markers.map((marker) => marker.num), [1, 2])
      assert.deepEqual(scan(editor).entries.map((entry) => entry.content), ['A note', 'B note'])
      assert.deepEqual(scan(editor).markers.map((marker) => marker.id), [idA, idB])
      assert.deepEqual(scan(editor).entries.map((entry) => entry.id), [idA, idB])
      assert.equal(scan(editor).sections.length, 1)
      assert.equal(editor.view.dom.querySelectorAll('h1.mew-annotation-section').length, 1)
      assert.doesNotMatch(markdown(editor), /data-annotation-id/)
    }
  } finally { a.destroy(); b.destroy(); docA.destroy(); docB.destroy() }
})

test('multi-digit markers behave as one unit for caret movement and deletion', () => {
  const editor = makeEditor(Array.from({ length: 12 }, (_, index) => `본문^[${index + 1}]`).join(' ') + '\n\n# $Annotations$\n\n' + Array.from({ length: 12 }, (_, index) => `${index + 1}. 내용${index + 1}`).join('\n'))
  try {
    const marker = scan(editor).markers[11]
    editor.commands.setTextSelection(marker.to)
    const key = (name: string) => editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, new window.KeyboardEvent('keydown', { key: name }) as unknown as KeyboardEvent))
    assert.equal(key('ArrowLeft'), true)
    assert.equal(editor.state.selection.from, marker.from)
    assert.equal(key('ArrowRight'), true)
    assert.equal(editor.state.selection.from, marker.to)
    assert.equal(key('Backspace'), true)
    assert.equal(scan(editor).markers.length, 11)
    assert.equal(scan(editor).entries.length, 11)
    assert.doesNotMatch(markdown(editor), /내용12/)
  } finally { editor.destroy() }
})

test('textarea spaces, indentation, blank lines, and HTML-like literal text survive saving and reloading', async () => {
  const { readSourceAnnotations } = await import('./annotationSource.ts')
  const editor = makeEditor('본문^[1]\n\n# $Annotations$\n\n1. 원래 주석')
  try {
    for (const text of [' leading ', 'a\n    b', '  ', '\tleading\t', '<b>literal</b> *bold*', '\n']) {
      assert.equal(updateAnnotation(editor, 1, text), true)
      const saved = markdown(editor)
      assert.equal(readSourceAnnotations(saved)[0].content, text)
      editor.commands.setContent(saved)
      assert.equal(scan(editor).entries[0].content, text)
      assert.equal(readSourceAnnotations(markdown(editor))[0].content, text)
    }
  } finally { editor.destroy() }
})
