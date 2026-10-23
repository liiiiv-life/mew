import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

const win = new Window({ url: 'http://localhost' })
const globals = win as unknown as Record<string, unknown>
for (const key of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver']) {
  if (!(key in globalThis)) Object.defineProperty(globalThis, key, { value: globals[key], configurable: true })
}

const { Editor, Node: TiptapNode } = await import('@tiptap/core')
const { Fragment } = await import('@tiptap/pm/model')
const { history, undo, redo, closeHistory } = await import('@tiptap/pm/history')
const { serverEditorExtensions } = await import('../serverExtensions.ts')
const { IncrementalMarkdownSerializer, IncrementalMarkdown, getIncrementalMarkdown } = await import('./incrementalMarkdown.ts')

type Ed = InstanceType<typeof Editor>
const makeEditor = (content: string | Record<string, unknown> = '') => new Editor({
  element: document.createElement('div'), extensions: serverEditorExtensions(), content,
})
const nativeSerializer = (editor: Ed) => (editor.storage as any).markdown.serializer

function assertMatches(editor: Ed, cached: InstanceType<typeof IncrementalMarkdownSerializer>, label = '') {
  const doc = editor.state.doc
  const native = nativeSerializer(editor)
  const expected = (native.native ?? native).serialize(doc)
  assert.equal(cached.serialize(doc), expected, label)
  const blocks = cached.blocks(doc)
  assert.equal(blocks.map(block => block.text).join(''), expected, `${label}: block contributions`)
  let line = 1
  let offset = 0
  for (const block of blocks) {
    assert.equal(block.from, offset)
    assert.equal(block.sourceStartLine, line)
    line += [...block.text].filter(character => character === '\n').length
    offset += block.node.nodeSize
  }
}

test('heterogeneous Markdown, normalization, and single-node edits match the native serializer exactly', () => {
  const sources = [
    '', '일반 문단', '**굵게** *기울임* ~~취소~~ `inline`',
    '** 앞 공백** · ***여러 서식*** · [**링크**](./file.md) · https://example.com',
    '# 제목\n\n첫 **문단**\n강제 줄바꿈  \n다음 줄\n\n> 인용\n>\n> - 중첩 항목\n\n---\n\n끝',
    '- 첫 항목\n  - **하위**\n  - 둘째\n- 마지막\n\n1. 하나\n2. 둘\n\n- [ ] 할 일\n- [x] 완료',
    '| A | B |\n| --- | --- |\n| **1** | [2](./note.md) |\n\n마지막',
    '```ts\nconst value = `x`\n```\n\n![사진](./image.png "그림")',
    '<audio src="./sample.mp3" controls></audio>\n\n<video src="./sample.mp4" controls></video>',
    '본문 [^1] 과 [^2]\n\n# References\n\n1. 첫 참고문헌\n2. **둘째** 참고문헌',
  ]
  for (const source of sources) {
    const editor = makeEditor(source)
    const cached = new IncrementalMarkdownSerializer(nativeSerializer(editor))
    try {
      assertMatches(editor, cached, source)
      const positions: number[] = []
      editor.state.doc.descendants((node, position) => { if (node.isText) positions.push(position) })
      for (const position of positions.slice(0, 6).reverse()) {
        editor.view.dispatch(editor.state.tr.insertText('새', position))
        assertMatches(editor, cached, `edit: ${source}`)
      }
      const saved = cached.serialize(editor.state.doc)
      editor.commands.setContent(saved)
      assertMatches(editor, cached, `normalized: ${source}`)
    } finally { editor.destroy() }
  }
})

test('adjacent ordered/bullet lists retain separators when reused, moved, and preceded by another list', () => {
  const editor = makeEditor('1. 하나\n2. 둘')
  const cached = new IncrementalMarkdownSerializer(nativeSerializer(editor))
  try {
    const ordered = editor.state.doc.firstChild!
    const bullet = editor.schema.nodes.bulletList.create(null, ordered.content)
    const paragraph = editor.schema.nodes.paragraph.create(null, editor.schema.text('중간'))
    for (const nodes of [
      [ordered, ordered, ordered, ordered],
      [bullet, bullet, ordered, ordered, ordered],
      [paragraph, ordered, ordered, paragraph, ordered],
      [ordered, paragraph, ordered, ordered],
    ]) {
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, nodes))
      assertMatches(editor, cached)
      for (let pos = 0; pos <= editor.state.doc.content.size; pos++) {
        const expected = nativeSerializer(editor).serialize(editor.state.doc.cut(0, pos).content)
        assert.equal(cached.sourceLineOfPos(editor.state.doc, pos), expected.split('\n').length)
      }
    }
  } finally { editor.destroy() }
})

test('empty, hard-break, whitespace, and trailing paragraphs preserve exact native output', () => {
  const editor = makeEditor()
  const cached = new IncrementalMarkdownSerializer(nativeSerializer(editor))
  const paragraph = editor.schema.nodes.paragraph
  const text = (value: string) => paragraph.create(null, editor.schema.text(value))
  const empty = paragraph.create()
  const hardBreak = paragraph.create(null, editor.schema.nodes.hardBreak.create())
  try {
    for (const nodes of [
      [empty], [empty, empty], [empty, text('끝')], [text('앞'), empty],
      [text('앞'), empty, empty], [text('앞'), hardBreak], [hardBreak, text('끝')],
      [text('앞\n\n\n'), empty], [text('   '), empty],
      [text('앞'), text('   '), empty], [text('**'), empty],
    ]) {
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, nodes))
      assertMatches(editor, cached, JSON.stringify(nodes.map(node => node.toJSON())))
      for (let pos = 0; pos <= editor.state.doc.content.size; pos++) {
        const expected = nativeSerializer(editor).serialize(editor.state.doc.cut(0, pos).content)
        assert.equal(cached.sourceLineOfPos(editor.state.doc, pos), expected.split('\n').length)
      }
    }
  } finally { editor.destroy() }
})

test('HTML table fallback and inline marks match after table edits', () => {
  const editor = makeEditor('| A | B |\n| --- | --- |\n| **1** | 2 |\n\n후속 문단')
  const cached = new IncrementalMarkdownSerializer(nativeSerializer(editor))
  try {
    assertMatches(editor, cached)
    let cell = -1
    editor.state.doc.descendants((node, position) => { if (cell < 0 && node.type.name === 'tableCell') cell = position })
    const node = editor.state.doc.nodeAt(cell)!
    editor.view.dispatch(editor.state.tr.insert(cell + node.nodeSize - 1, editor.schema.nodes.paragraph.create(null, editor.schema.text('추가'))))
    assertMatches(editor, cached)
    editor.view.dispatch(editor.state.tr.setNodeAttribute(cell, 'colspan', 2))
    assertMatches(editor, cached)
    assert.match(cached.serialize(editor.state.doc), /<table/)
  } finally { editor.destroy() }
})

test('clipboard Fragment serialization keeps native list and paragraph parent semantics', () => {
  const editor = makeEditor('- 부모\n  - **자식1**\n  - 자식2\n\n마지막')
  const native = nativeSerializer(editor)
  const cached = new IncrementalMarkdownSerializer(native)
  try {
    const doc = editor.state.doc
    const fragments = [doc.content, Fragment.from(doc.lastChild!), doc.slice(4, doc.content.size - 2, true).content]
    for (const fragment of fragments) assert.equal(cached.serialize(fragment), native.serialize(fragment))
    assertMatches(editor, cached)
  } finally { editor.destroy() }
})

test('undo and redo reuse immutable nodes without losing current document output', () => {
  const editor = makeEditor('첫 **문단**\n\n둘째 문단\n\n마지막')
  editor.registerPlugin(history())
  const cached = new IncrementalMarkdownSerializer(nativeSerializer(editor))
  try {
    const before = cached.serialize(editor.state.doc)
    editor.view.dispatch(closeHistory(editor.state.tr).insertText('새', 2))
    assertMatches(editor, cached)
    const after = cached.serialize(editor.state.doc)
    assert.notEqual(before, after)
    assert.ok(undo(editor.state, transaction => editor.view.dispatch(transaction)))
    assertMatches(editor, cached)
    assert.equal(cached.serialize(editor.state.doc), before)
    assert.ok(redo(editor.state, transaction => editor.view.dispatch(transaction)))
    assertMatches(editor, cached)
    assert.equal(cached.serialize(editor.state.doc), after)
  } finally { editor.destroy() }
})

test('a single edit rerenders one block and repeated serialization rerenders none', () => {
  const editor = makeEditor(Array.from({ length: 1000 }, (_, index) => `문단 ${index} **강조** [링크](./note.md)`).join('\n\n'))
  const native = nativeSerializer(editor)
  let renders = 0
  let fragmentRenders = 0
  const observed = Object.create(native)
  Object.defineProperty(observed, 'nodes', { get() {
    return Object.fromEntries(Object.entries(native.nodes).map(([name, render]) => [name, (...args: any[]) => {
      if (args[2]?.type?.name === 'doc') renders++
      if (args[2] instanceof Fragment) fragmentRenders++
      return (render as (...values: any[]) => void)(...args)
    }]))
  } })
  const cached = new IncrementalMarkdownSerializer(observed)
  try {
    assertMatches(editor, cached)
    assert.equal(renders, 1000)
    const end = editor.state.doc.content.size
    assert.equal(cached.sourceLineOfPos(editor.state.doc, end), native.serialize(editor.state.doc.cut(0, end).content).split('\n').length)
    assert.equal(fragmentRenders, 1, 'prefix lookup renders only the containing block')
    for (let index = 0; index < 4; index++) cached.serialize(editor.state.doc)
    assert.equal(renders, 1000)
    editor.view.dispatch(editor.state.tr.insertText('새', 3))
    assertMatches(editor, cached)
    assert.equal(renders, 1001)
  } finally { editor.destroy() }
})

test('priority-40 extension installs before first view and exposes the shared cached serializer', () => {
  const editor = new Editor({
    element: document.createElement('div'), extensions: [...serverEditorExtensions(), IncrementalMarkdown], content: '시작 **강조**',
  })
  try {
    const serializer = getIncrementalMarkdown(editor)
    assert.ok(serializer)
    const wrapped = new IncrementalMarkdownSerializer(serializer)
    assert.equal(wrapped.native, serializer.native)
    assert.equal(wrapped.serialize(editor.state.doc), serializer.native.serialize(editor.state.doc))
    assert.equal((editor.storage as any).markdown.serializer, serializer)
    assert.equal((editor.storage as any).markdown.getMarkdown(), serializer.native.serialize(editor.state.doc))
    editor.view.dispatch(editor.state.tr.insertText('새', 2))
    assert.equal((editor.storage as any).markdown.getMarkdown(), serializer.native.serialize(editor.state.doc))
  } finally { editor.destroy() }
  assert.equal(getIncrementalMarkdown(editor), null)
})

test('reused heterogeneous nodes keep native output across deterministic boundary combinations', () => {
  const editor = makeEditor('# 제목\n\n문단 **강조**와 *기울임*\n\n> 인용\n\n- 항목\n  - 하위\n\n1. 번호\n\n- [x] 완료\n\n```js\nconsole.log(1)\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n---')
  const cached = new IncrementalMarkdownSerializer(nativeSerializer(editor))
  const pool = [...editor.state.doc.content.content]
  const paragraph = editor.schema.nodes.paragraph
  for (const value of ['   ', '\n\n', '끝\n\n\n', '![]', ' ** ']) pool.push(paragraph.create(null, editor.schema.text(value)))
  for (const mark of [editor.schema.marks.bold, editor.schema.marks.italic, editor.schema.marks.strike]) {
    for (const value of ['앞', ' a ', '!a!', '(a)', '\n a \n', '**']) {
      pool.push(paragraph.create(null, editor.schema.text(value, [mark.create()])))
    }
  }
  pool.push(paragraph.create(), paragraph.create(null, editor.schema.nodes.hardBreak.create()))
  let seed = 0x5eeda11
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  try {
    for (let iteration = 0; iteration < 180; iteration++) {
      const nodes = Array.from({ length: 1 + random() % 18 }, () => pool[random() % pool.length])
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, nodes))
      assertMatches(editor, cached, `boundary combination ${iteration}`)
    }
  } finally { editor.destroy() }
})

test('a custom renderer rewriting preceding output keeps exact fallback block contributions', () => {
  const Rewrite = TiptapNode.create({
    name: 'prefixRewrite', group: 'block', atom: true,
    parseHTML: () => [{ tag: 'prefix-rewrite' }], renderHTML: () => ['prefix-rewrite'],
    addStorage: () => ({ markdown: { serialize(state: any, node: any) {
      state.out = 'rewritten'
      state.closeBlock(node)
    } } }),
  })
  const editor = new Editor({
    element: document.createElement('div'), extensions: [...serverEditorExtensions(), Rewrite],
    content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'previous output' }] },
      { type: 'prefixRewrite' }, { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
    ] },
  })
  const cached = new IncrementalMarkdownSerializer(nativeSerializer(editor))
  try {
    assertMatches(editor, cached)
    assert.equal(cached.blocks(editor.state.doc)[0].text, '')
    for (let pos = 0; pos <= editor.state.doc.content.size; pos++) {
      const expected = nativeSerializer(editor).serialize(editor.state.doc.cut(0, pos).content)
      assert.equal(cached.sourceLineOfPos(editor.state.doc, pos), expected.split('\n').length)
    }
  } finally { editor.destroy() }
})

test('prefix line lookup matches native Fragment serialization at every position in heterogeneous documents', () => {
  for (const source of [
    '# 제목\n\n문단 **강조**\n\n> 인용\n>\n> - 항목\n\n1. 하나\n2. 둘\n\n- [ ] 할 일\n- [x] 완료\n\n끝',
    '| A | B |\n| --- | --- |\n| **1** | 2 |\n\n```ts\nconst x = 1\n\nconsole.log(x)\n```\n\n![사진](./image.png)',
    '<br/>\n\n문단\n\n<br/>',
    '본문 [^1]\n\n# References\n\n1. 참고문헌',
  ]) {
    const editor = makeEditor(source)
    const cached = new IncrementalMarkdownSerializer(nativeSerializer(editor))
    try {
      for (let pos = 0; pos <= editor.state.doc.content.size; pos++) {
        const expected = nativeSerializer(editor).serialize(editor.state.doc.cut(0, pos).content)
        assert.equal(cached.sourceLineOfPos(editor.state.doc, pos), expected.split('\n').length, `position ${pos}: ${source}`)
      }
    } finally { editor.destroy() }
  }
})
