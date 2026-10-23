import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deleteSourceAnnotation, findSourceAnnotation, insertSourceAnnotation, readSourceAnnotations, sourceAnnotationIdentity, updateSourceAnnotation } from './annotationSource.ts'

test('inserts at a source cursor, preserving selected text and unrelated bytes', () => {
  const original = '---\ntitle: "unchanged"\n---\n\n# Heading\n\n**Chosen text** tail\n'
  const at = original.indexOf(' tail')
  const inserted = insertSourceAnnotation(original, at)!
  assert.equal(inserted.num, 1)
  assert.equal(inserted.at, at + '^[1]'.length)
  assert.equal(inserted.content.slice(0, at), original.slice(0, at))
  assert.match(inserted.content, /\*\*Chosen text\*\*\^\[1\] tail/)
  assert.match(inserted.content, /# \$Annotations\$\n\n1\. /)
  assert.deepEqual(readSourceAnnotations(inserted.content), [{ num: 1, content: '' }])
})

test('inserting in the middle reorders markers and carries old contents', () => {
  const source = 'First^[1], last^[2].\n\n# $Annotations$\n\n1. alpha\n2. omega\n'
  const inserted = insertSourceAnnotation(source, source.indexOf(', last'))!
  assert.equal(inserted.num, 2)
  assert.match(inserted.content, /^First\^\[1\]\^\[2\], last\^\[3\]/)
  assert.deepEqual(readSourceAnnotations(inserted.content), [
    { num: 1, content: 'alpha' }, { num: 2, content: '' }, { num: 3, content: 'omega' },
  ])
})

test('updates textarea text as literal Markdown and safe multiline list content', () => {
  const original = 'Text^[1].\n\n# $Annotations$\n\n1. old\n\n## After\nuntouched **body**\n'
  const content = '*bold* [link](https://example.test) <script>x</script> \\ backtick `\n# heading\n2. list'
  const updated = updateSourceAnnotation(original, 1, content)
  assert.deepEqual(readSourceAnnotations(updated), [{ num: 1, content }])
  assert.ok(updated.endsWith('## After\nuntouched **body**\n'))
  assert.ok(updated.startsWith('Text^[1].\n\n# $Annotations$\n\n'))
  assert.match(updated, /\\<script\\>/)
})

test('preserves empty intermediate and trailing textarea lines', () => {
  const original = 'Text^[1].\n\n# $Annotations$\n\n1. old\n'
  for (const content of ['first\n\nthird\n', '\nfirst', '\n', '', '  leading\ntrailing  \n\tindent']) {
    const updated = updateSourceAnnotation(original, 1, content)
    assert.deepEqual(readSourceAnnotations(updated), [{ num: 1, content }])
  }
})

test('preserves spaces while typing and after reopening the textarea', () => {
  const source = 'Text^[1].\n\n# $Annotations$\n\n1. old\n'
  for (const content of ['Hello ', ' Leading', 'Hello world']) {
    assert.deepEqual(readSourceAnnotations(updateSourceAnnotation(source, 1, content)), [{ num: 1, content }])
  }
})

test('source identity changes when a new marker takes the old number and position', () => {
  const source = 'Text^[1].\n\n# $Annotations$\n\n1. old\n'
  const identity = sourceAnnotationIdentity(source, 1)
  const inserted = insertSourceAnnotation(source, source.indexOf('^[1]'))!
  assert.equal(findSourceAnnotation(source, 1), findSourceAnnotation(inserted.content, 1))
  assert.notEqual(sourceAnnotationIdentity(inserted.content, 1), identity)
  assert.notEqual(sourceAnnotationIdentity(inserted.content, 2), identity)
  assert.equal(sourceAnnotationIdentity(source, 2), null)
})

test('source identity survives metadata edits, including when body markers follow the section', () => {
  for (const source of [
    'Text^[1].\n\n# $Annotations$\n\n1. old\n',
    'Text^[1].\n\n# $Annotations$\n\n1. old\n2. last\n\n## Later\nTail^[2].\n',
  ]) {
    const identity = sourceAnnotationIdentity(source, 1)
    const lastIdentity = sourceAnnotationIdentity(source, 2)
    const updated = updateSourceAnnotation(source, 1, 'a much longer note\nwith another line')
    assert.equal(sourceAnnotationIdentity(updated, 1), identity)
    assert.equal(sourceAnnotationIdentity(updated, 2), lastIdentity)
  }
})

test('deletes marker and its entry, renumbers, and removes the last heading', () => {
  const source = 'First^[1], second^[2].\n\n# $Annotations$\n\n1. first\n2. second\n\n## Tail\nkeep\n'
  const one = deleteSourceAnnotation(source, 1)
  assert.match(one, /^First, second\^\[1\]/)
  assert.deepEqual(readSourceAnnotations(one), [{ num: 1, content: 'second' }])
  const none = deleteSourceAnnotation(one, 1)
  assert.equal(none, 'First, second.\n\n## Tail\nkeep\n')
  assert.deepEqual(readSourceAnnotations(none), [])
})

test('does not treat code, escapes, frontmatter, or non-top-level headings as annotations', () => {
  const source = '---\nkey: ^[1]\n---\n\n`inline ^[1]` \\^[1]\n\n```md\n^[1]\n# $Annotations$\n1. code\n```\n\n> # $Annotations$\n> 1. quoted\n\nReal^[1].\n\n# $Annotations$\n\n1. real\n'
  assert.equal(findSourceAnnotation(source, 1), source.indexOf('^[1]', source.indexOf('Real')))
  assert.deepEqual(readSourceAnnotations(source), [{ num: 1, content: 'real' }])
  assert.equal(insertSourceAnnotation(source, source.indexOf('key:') + 5), null)
  assert.equal(insertSourceAnnotation(source, source.indexOf('inline') + 2), null)
  assert.equal(insertSourceAnnotation(source, source.indexOf('^[1]', source.indexOf('```md'))), null)
  assert.equal(insertSourceAnnotation(source, source.lastIndexOf('1. real') + 3), null)
  const deleted = deleteSourceAnnotation(source, 1)
  assert.ok(deleted.includes('key: ^[1]'))
  assert.ok(deleted.includes('`inline ^[1]` \\^[1]'))
  assert.ok(deleted.includes('```md\n^[1]\n# $Annotations$\n1. code\n```'))
})

test('unmatched code delimiters do not protect unrelated paragraphs', () => {
  const source = 'A literal ` delimiter.\n\nA separate paragraph.\n\nAnother ` delimiter.\n'
  const at = source.indexOf('separate') + 'separate'.length
  const inserted = insertSourceAnnotation(source, at)
  assert.ok(inserted)
  assert.ok(inserted.content.includes('separate^[1] paragraph'))
})

test('retains orphan entries and malformed section content', () => {
  const source = 'Text^[1].\n\n# $Annotations$\n\n1. linked\n2. orphan\n\nmanual note\n\n# Rest\nkeep\n'
  const deleted = deleteSourceAnnotation(source, 1)
  assert.deepEqual(readSourceAnnotations(deleted), [{ num: 1, content: 'orphan' }])
  assert.ok(deleted.includes('manual note\n\n# Rest\nkeep\n'))
  const noOrphan = deleteSourceAnnotation(deleted, 1)
  assert.ok(noOrphan.includes('# $Annotations$\n\nmanual note'))
  assert.ok(noOrphan.endsWith('# Rest\nkeep\n'))
})

test('preserves CRLF and content outside the managed list during updates', () => {
  const source = '---\r\ntitle: X\r\n---\r\n\r\nText^[1].\r\n\r\n# $Annotations$\r\n\r\n1. old\r\n\r\n## Later\r\nkeep\r\n'
  const updated = updateSourceAnnotation(source, 1, 'new\nline')
  assert.deepEqual(readSourceAnnotations(updated), [{ num: 1, content: 'new\nline' }])
  assert.equal(updated.replace(/\r\n/g, '').includes('\n'), false)
  assert.ok(updated.startsWith(source.slice(0, source.indexOf('1. old'))))
  assert.ok(updated.endsWith('## Later\r\nkeep\r\n'))
})

test('reads paragraphs and links as textarea text without changing their source on renumbering', () => {
  const source = 'Text^[1].\n\n# $Annotations$\n\n1. [Link](https://example.test)\n\n   next paragraph\n'
  assert.deepEqual(readSourceAnnotations(source), [{ num: 1, content: 'Link\nnext paragraph' }])
  const inserted = insertSourceAnnotation(source, 0)!
  assert.ok(inserted.content.includes('2. [Link](https://example.test)\n\n   next paragraph\n'))
})

test('reads actual markers in headings, nested lists, blockquotes, and tables', () => {
  const source = '# Heading^[1]\n\n- nested\n  - item^[2]\n\n> quote^[3]\n\n| A | B |\n|---|---|\n| one^[4] | two^[5] |\n\n# $Annotations$\n\n1. h\n2. l\n3. q\n4. a\n5. b\n'
  for (let num = 1; num <= 5; num++) assert.equal(findSourceAnnotation(source, num), source.indexOf(`^[${num}]`))
})

test('finds and deletes table markers when the cell has escaped pipes', () => {
  const source = '| A | B |\n|---|---|\n| a\\|b^[1] | a |\n\n# $Annotations$\n\n1. old\n'
  assert.equal(findSourceAnnotation(source, 1), source.indexOf('^[1]'))
  assert.equal(deleteSourceAnnotation(source, 1), '| A | B |\n|---|---|\n| a\\|b | a |\n\n')
})

test('leaves absent annotations and malformed markers unchanged', () => {
  const source = 'No annotations.\n\n## $Annotations$\n\n1. ordinary list\n'
  assert.deepEqual(readSourceAnnotations(source), [])
  assert.equal(deleteSourceAnnotation(source, 1), source)
  assert.equal(updateSourceAnnotation(source, 1, 'new'), source)
  assert.equal(findSourceAnnotation('^[0] ^[-1] ^[NaN] ^[9007199254740992]', 1), null)
})

test('source multiline entries survive the actual Hotview Markdown parser and serializer', async () => {
  const { Window } = await import('happy-dom')
  const win = new Window({ url: 'http://localhost' })
  const globals = win as unknown as Record<string, unknown>
  for (const key of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'HTMLAnchorElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver']) {
    if (!(key in globalThis)) Object.defineProperty(globalThis, key, { value: globals[key], configurable: true })
  }
  const { Editor } = await import('@tiptap/core')
  const { serverEditorExtensions } = await import('../serverExtensions.ts')
  const { scanAnnotations } = await import('./annotations.ts')
  for (const content of ['first\nsecond', 'first\n\nthird\n', '\nfirst', '\n', '*literal* <br/>']) {
    const source = updateSourceAnnotation('Body^[1].\n\n# $Annotations$\n\n1. old\n', 1, content)
    const editor = new Editor({ element: win.document.createElement('div') as unknown as HTMLElement, extensions: serverEditorExtensions(), content: source })
    try {
      assert.equal(scanAnnotations(editor.state.doc).entries[0].content, content)
      const serialized = (editor.storage as { markdown: { getMarkdown(): string } }).markdown.getMarkdown()
      assert.deepEqual(readSourceAnnotations(serialized), [{ num: 1, content }])
    } finally { editor.destroy() }
  }
})
