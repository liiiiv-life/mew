// 커서가 있는 줄 고르기 — 번호를 그리는 대상(최상위 블록 / 리스트 항목)과 같은 노드를 골라야 한다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

// tiptap/ProseMirror가 전역 DOM을 보도록 happy-dom 셧을 먼저 깐다 (headingShortcut.test.ts와 같은 방식)
const win = new Window({ url: 'http://localhost' })
const w = win as unknown as Record<string, unknown>
for (const k of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver', 'KeyboardEvent']) {
  if (k in globalThis) continue
  try {
    ;(globalThis as Record<string, unknown>)[k] = w[k]
  } catch {
    Object.defineProperty(globalThis, k, { value: w[k], configurable: true })
  }
}

const { Editor } = await import('@tiptap/core')
const { serverEditorExtensions } = await import('../serverExtensions.ts')
const { LineFocus, focusedLinePos, selectedLinePositions, lineNumberAttrs, listLevel } = await import('./lineFocus.ts')

function buildEditor(content: string) {
  return new Editor({ element: document.createElement('div'), extensions: [...serverEditorExtensions(), LineFocus], content })
}

function gutter(editor: ReturnType<typeof buildEditor>): (string | null)[] {
  return Array.from(editor.view.dom.querySelectorAll('*'))
    .filter(el => el.tagName === 'LI' || (el.parentElement === editor.view.dom && !['UL', 'OL'].includes(el.tagName)))
    .map((el) => el.getAttribute('data-mew-line-numbers'))
}

test('체크 목록의 각 항목과 중첩 항목도 원문 줄번호와 깊이를 갖는다', () => {
  const source = '- [ ] 첫 항목\n- [x] 둘째\n  - [ ] 하위'
  const editor = new Editor({ element: document.createElement('div'), extensions: [...serverEditorExtensions(), LineFocus.configure({ getSource: () => source })], content: source })
  try {
    assert.deepEqual(gutter(editor), ['1', '2', '3'])
    const positions: number[] = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'taskItem') positions.push(pos) })
    assert.deepEqual(positions.map(pos => listLevel(editor.state.doc, pos)), [1, 1, 2])
    editor.commands.setTextSelection(positions[2] + 2)
    assert.equal(focusedLinePos(editor.state), positions[2])
  } finally { editor.destroy() }
})

test('편집 직후 이전 원문이 남아 있어도 중간 삽입·삭제의 줄번호를 즉시 갱신한다', () => {
  let source = '첫 문단\n\n마지막 문단'
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), LineFocus.configure({ getSource: () => source })],
    content: source,
  })
  try {
    const pos = editor.state.doc.firstChild!.nodeSize
    const paragraph = editor.schema.nodes.paragraph.create(null, editor.schema.text('중간'))
    editor.view.dispatch(editor.state.tr.insert(pos, paragraph))
    assert.deepEqual(gutter(editor), ['1', '3', '5'])
    // React가 직전 편집의 원문을 반영한 직후 다시 수정해도 한 단계 뒤처지면 안 된다.
    source = (editor.storage as any).markdown.getMarkdown()
    editor.view.dispatch(editor.state.tr.insert(pos, paragraph))
    assert.deepEqual(gutter(editor), ['1', '3', '5', '7'])
    editor.view.dispatch(editor.state.tr.delete(pos, pos + paragraph.nodeSize * 2))
    assert.deepEqual(gutter(editor), ['1', '3'])
  } finally { editor.destroy() }
})

test('마지막 편집용 빈 문단도 앞 블록과 frontmatter 다음 번호를 갖는다', () => {
  const source = '```\n첫 줄\n둘째 줄\n```'
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), LineFocus.configure({ getSource: () => source, getLineOffset: () => 7 })],
    content: source,
  })
  try {
    editor.commands.setTextSelection(1) // trailingNode가 마지막 빈 문단을 추가한다.
    assert.deepEqual(gutter(editor), ['8', '12'])
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.commands.insertContent('마지막')
    assert.deepEqual(gutter(editor), ['8', '13'])
  } finally { editor.destroy() }
})

test('빈 문단과 여러 줄 목록도 문서 전체의 Markdown 줄번호로 계산한다', () => {
  const editor = buildEditor('- 첫 줄  \n  이어지는 줄\n- 둘째 항목\n\n마지막')
  try {
    const serializer = (editor.storage as any).markdown.serializer
    assert.deepEqual(lineNumberAttrs(editor.state.doc, (c) => serializer.serialize(c)).map(a => a.lineNumbers), ['1', '3', '5'])
    editor.view.dispatch(editor.state.tr.insert(0, editor.schema.nodes.paragraph.create()))
    assert.deepEqual(gutter(editor), ['1', '3', '5', '7'])
  } finally { editor.destroy() }
})

test('구분선·들여쓴 코드·숨겨진 주석이 뒤 문단의 원본 줄번호를 빼앗지 않는다', () => {
  const source = '첫 문단\n\n---\n\n    코드\n\n<!-- 숨김 -->\n\n마지막'
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), LineFocus.configure({ getSource: () => source })],
    content: source,
  })
  try { assert.deepEqual(gutter(editor), ['1', '3', '5', '9']) }
  finally { editor.destroy() }
})

test('원본 줄 간격은 커서 이동에서 보존하고 외부 교체·오프셋 변경은 새 번호를 쓴다', () => {
  let source = '첫 문단\n이어지는 줄\n\n\n마지막'
  let offset = 7
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), LineFocus.configure({ getSource: () => source, getLineOffset: () => offset })],
    content: source,
  })
  try {
    assert.deepEqual(gutter(editor), ['8', '12'])
    editor.commands.setTextSelection(2)
    assert.deepEqual(gutter(editor), ['8', '12'])
    source = '교체\n\n```\n코드\n```'
    editor.commands.setContent(source, { emitUpdate: false })
    assert.deepEqual(gutter(editor), ['8', '10', '13'])
    offset = 9
    editor.view.dispatch(editor.state.tr)
    assert.deepEqual(gutter(editor), ['10', '12', '15'])
  } finally { editor.destroy() }
})

/** 커서를 그 글자 위에 놓고, 골라진 줄 노드의 타입·본문·리스트 깊이를 돌려준다 */
function lineAt(editor: ReturnType<typeof buildEditor>, text: string) {
  let pos = -1
  editor.state.doc.descendants((node, nodePos) => {
    if (pos < 0 && node.isText && node.text?.includes(text)) pos = nodePos + (node.text.indexOf(text) + 1)
  })
  assert.ok(pos >= 0, `본문에 "${text}"가 있어야 한다`)
  editor.commands.setTextSelection(pos)
  const linePos = focusedLinePos(editor.state)
  const line = editor.state.doc.nodeAt(linePos)
  return { type: line?.type.name, text: line?.textContent, level: listLevel(editor.state.doc, linePos) }
}

function textPos(editor: ReturnType<typeof buildEditor>, text: string, offset = 1): number {
  let pos = -1
  editor.state.doc.descendants((node, nodePos) => {
    if (pos < 0 && node.isText && node.text?.includes(text)) pos = nodePos + node.text.indexOf(text) + offset
  })
  assert.ok(pos >= 0, `본문에 "${text}"가 있어야 한다`)
  return pos
}

function selectedLineTexts(editor: ReturnType<typeof buildEditor>, fromText: string, toText: string): string[] {
  const from = textPos(editor, fromText, 1)
  const to = textPos(editor, toText, toText.length)
  editor.commands.setTextSelection({ from, to })
  return selectedLinePositions(editor.state).map((pos) => editor.state.doc.nodeAt(pos)?.textContent ?? '')
}

test('본문 줄은 최상위 블록 하나가 한 줄이고, 들여쓰기 되돌림은 0이다', () => {
  const editor = buildEditor('첫 문단\n\n# 제목\n')
  assert.deepEqual(lineAt(editor, '첫 문단'), { type: 'paragraph', text: '첫 문단', level: 0 })
  assert.deepEqual(lineAt(editor, '제목'), { type: 'heading', text: '제목', level: 0 })
})

test('손잡이 클릭으로 블록을 통째로 선택해도 그 블록이 잡힌다', () => {
  const editor = buildEditor('첫 문단\n\n둘째 문단\n')
  let target = -1
  editor.state.doc.forEach((node, pos) => {
    if (node.textContent === '둘째 문단') target = pos
  })
  assert.ok(target >= 0)
  editor.commands.setNodeSelection(target)
  assert.equal(focusedLinePos(editor.state), target)
})

test('리스트는 항목이 한 줄이고, 중첩되면 가장 안쪽 항목이 그 깊이로 잡힌다', () => {
  const editor = buildEditor('- 바깥\n  - 안쪽\n')
  assert.deepEqual(lineAt(editor, '안쪽'), { type: 'listItem', text: '안쪽', level: 2 })
  const outer = lineAt(editor, '바깥')
  assert.equal(outer.type, 'listItem')
  assert.equal(outer.level, 1)
  // 바깥 항목은 중첩 리스트를 품고 있다 — 그래도 골라진 것은 커서가 있는 바깥 항목이다
  assert.ok(outer.text?.startsWith('바깥'))
})

test('여러 문단을 선택하면 걸친 줄 번호가 모두 포커스된다', () => {
  const editor = buildEditor('첫 문단\n\n둘째 문단\n\n셋째 문단\n')
  assert.deepEqual(selectedLineTexts(editor, '첫', '셋째'), ['첫 문단', '둘째 문단', '셋째 문단'])
})

test('제목 줄이 선택 범위에 걸치면 제목 줄 번호도 포커스된다', () => {
  const editor = buildEditor('첫 문단\n\n## 제목\n\n둘째 문단\n')
  assert.deepEqual(selectedLineTexts(editor, '첫', '둘째'), ['첫 문단', '제목', '둘째 문단'])
})

test('안쪽 리스트만 선택하면 바깥 항목 줄 번호는 같이 포커스되지 않는다', () => {
  const editor = buildEditor('- 바깥\n  - 안쪽 하나\n  - 안쪽 둘\n')
  assert.deepEqual(selectedLineTexts(editor, '안쪽 하나', '안쪽 둘'), ['안쪽 하나', '안쪽 둘'])
})

test('Hotview 줄 번호는 빈 줄과 파이프 표 줄 수를 반영하고, 표는 첫 줄번호만 표시한다', () => {
  const editor = buildEditor('앞 문단\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\n뒤 문단\n')
  const serializer = (editor.storage as any).markdown.serializer
  assert.deepEqual(lineNumberAttrs(editor.state.doc, (c) => serializer.serialize(c)).map(({ lineNumbers, lineCount }) => ({ lineNumbers, lineCount })), [
    { lineNumbers: '1', lineCount: 1 },
    { lineNumbers: '3', lineCount: 4 },
    { lineNumbers: '8', lineCount: 1 },
  ])
  assert.deepEqual(selectedLineTexts(editor, '뒤', '뒤'), ['뒤 문단'])
})

test('frontmatter 줄 수만큼 Hotview 본문 줄 번호를 밀어 원본 md 줄 번호와 맞춘다', () => {
  const editor = buildEditor('호흡을 통해\n\n| A |\n| --- |\n| B |\n\n마지막\n')
  const serializer = (editor.storage as any).markdown.serializer
  assert.deepEqual(lineNumberAttrs(editor.state.doc, (c) => serializer.serialize(c), 7).map(({ lineNumbers }) => lineNumbers), [
    '8',
    '10',
    '14',
  ])
})

test('원본 일반 텍스트 여러 줄이 paragraph 하나로 파싱되면 오브젝트 시작 줄번호만 표시한다', () => {
  const source = '호흡을 통해\n몸과 마음의 긴장을 풀어보겠습니다.\n천천히 내려놓습니다.\n\n다음 문단\n'
  const editor = buildEditor(source)
  const serializer = (editor.storage as any).markdown.serializer
  assert.deepEqual(lineNumberAttrs(editor.state.doc, (c) => serializer.serialize(c), 37, source).map(({ lineNumbers, lineCount }) => ({ lineNumbers, lineCount })), [
    { lineNumbers: '38', lineCount: 3 },
    { lineNumbers: '42', lineCount: 1 },
  ])
})

test('긴 원본 한 줄이 화면에서 접혀도 오브젝트 시작 줄번호 하나만 그린다', () => {
  const source = `${'아주 긴 한 줄 '.repeat(20)}\n\n다음 오브젝트\n`
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), LineFocus.configure({ getSource: () => source })],
    content: source,
  })
  assert.deepEqual(
    Array.from(editor.view.dom.querySelectorAll('[data-mew-line-numbers]')).map((el) => el.getAttribute('data-mew-line-numbers')),
    ['1', '3'],
  )
  assert.equal(editor.view.dom.querySelector('.mew-line-number-widget'), null)
})

test('frontmatter 뒤 일반 문단과 인용문의 번호가 실제 md 줄과 정확히 같다', () => {
  const source = [
    '명상 블록을 한 벌 생성해 업로드하는 절차.',
    '',
    '> 삭제된 도구에 관한 주의문.',
    '',
    '스타일과 문장 기준본.',
  ].join('\n')
  const editor = buildEditor(source)
  const serializer = (editor.storage as any).markdown.serializer
  const entries = lineNumberAttrs(editor.state.doc, (c) => serializer.serialize(c), 7, source).map((attr) => ({
    type: editor.state.doc.nodeAt(attr.pos)?.type.name,
    text: editor.state.doc.nodeAt(attr.pos)?.textContent,
    lineNumbers: attr.lineNumbers,
  }))
  assert.deepEqual(entries, [
    { type: 'paragraph', text: '명상 블록을 한 벌 생성해 업로드하는 절차.', lineNumbers: '8' },
    { type: 'blockquote', text: '삭제된 도구에 관한 주의문.', lineNumbers: '10' },
    { type: 'paragraph', text: '스타일과 문장 기준본.', lineNumbers: '12' },
  ])
})

test('일반 문단 포커스는 줄번호 색과 투명도 변수를 바꾼다', () => {
  const source = '8번째 줄 일반 문단\n'
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), LineFocus.configure({ getLineOffset: () => 7, getSource: () => source })],
    content: source,
  })
  editor.commands.setTextSelection(textPos(editor, '일반'))
  const line = editor.view.dom.querySelector('[data-mew-line-numbers="8"]')
  assert.ok(line?.classList.contains('mew-line--focus'))
})

test('코드블럭은 원본 줄 수만큼 다음 번호를 밀고, 화면에는 첫 줄번호만 표시한다', () => {
  const editor = buildEditor('앞 문단\n\n```ts\nconst a = 1\nconst b = 2\n```\n\n뒤 문단\n')
  const serializer = (editor.storage as any).markdown.serializer
  assert.deepEqual(lineNumberAttrs(editor.state.doc, (c) => serializer.serialize(c)).map(({ lineNumbers, lineCount }) => ({ lineNumbers, lineCount })), [
    { lineNumbers: '1', lineCount: 1 },
    { lineNumbers: '3', lineCount: 4 },
    { lineNumbers: '8', lineCount: 1 },
  ])
})

test('markdown-it 원본 line map으로 중첩 리스트와 코드블럭 시작 줄을 md와 맞춘다', () => {
  const source = [
    '블록 생성 시 문장 길이.',
    '',
    '### Gap 규칙',
    '',
    '- 각 세그먼트의 마지막이 무엇인지에 따라 기본값 있음.',
    '',
    '  - 기본 100ms',
    '  - 쉼표 : + 200ms',
    '  - 온점 : + 600ms',
    '',
    '- 블럭 끝날 때 : 1000ms',
    '',
    '- 커넥터 끝날 때 : 0ms',
    '',
    '### Segment 규칙',
    '',
    '세그먼트 하나가 30자를 넘어가면 안됨.',
    '',
    '### INTRO-BLOCK 1',
    '',
    '```',
    '오늘 하루도 고생 많으셨어요.',
    '편안한 곳에 누워 계신가요?',
    '```',
    '',
    '### BLOCK 1',
    '',
    '```',
    '수많은 생각들이 머릿속을 어지럽히지만,',
    '애써 밀어내려 하지 않아도 돼요.',
    '복잡했던 머리가 가벼워집니다.',
    '```',
    '',
    '### BLOCK 2',
    '',
  ].join('\n')
  const editor = buildEditor(source)
  const serializer = (editor.storage as any).markdown.serializer
  assert.deepEqual(lineNumberAttrs(editor.state.doc, (c) => serializer.serialize(c), 7, source).map(({ lineNumbers }) => lineNumbers), [
    '8',
    '10',
    '12',
    '14',
    '15',
    '16',
    '18',
    '20',
    '22',
    '24',
    '26',
    '28',
    '33',
    '35',
    '41',
  ])
})

test('긴 코드블럭은 원본 md 줄 범위만큼 다음 Hotview 줄번호를 밀어낸다', () => {
  const introLines = ['오늘 하루도 고생 많으셨어요.', '편안한 곳에 누워 계신가요?', '어깨 힘을 내려놓고,', '숨을 고릅니다.', '천천히 쉬어갑니다.']
  const blockLines = Array.from({ length: 14 }, (_, i) => `긴 코드블럭 ${i + 1}`)
  const source = [
    '준비 문단 1',
    '',
    '준비 문단 2',
    '',
    '준비 문단 3',
    '',
    '준비 문단 4',
    '',
    '준비 문단 5',
    '',
    '블록 생성 시 문장 길이.',
    '',
    '### Gap 규칙',
    '',
    '- 각 세그먼트의 마지막이 무엇인지에 따라 기본값 있음.',
    '',
    '  - 기본 100ms',
    '  - 쉼표 : + 200ms',
    '  - 온점 : + 600ms',
    '',
    '- 블럭 끝날 때 : 1000ms',
    '',
    '- 커넥터 끝날 때 : 0ms',
    '',
    '### Segment 규칙',
    '',
    '세그먼트 하나가 30자를 넘어가면 안됨.',
    '',
    '### INTRO-BLOCK 1',
    '',
    '```',
    ...introLines,
    '```',
    '',
    '### BLOCK 1',
    '',
    '```',
    ...blockLines,
    '```',
    '',
    '',
    '### BLOCK 2',
    '',
  ].join('\n')
  const editor = buildEditor(source)
  const serializer = (editor.storage as any).markdown.serializer
  const entries = lineNumberAttrs(editor.state.doc, (c) => serializer.serialize(c), 7, source).map((attr) => {
    const node = editor.state.doc.nodeAt(attr.pos)
    return { text: node?.textContent, type: node?.type.name, lineNumbers: attr.lineNumbers, lineCount: attr.lineCount }
  })

  assert.deepEqual(
    entries.filter(({ text }) => text === 'INTRO-BLOCK 1' || text === introLines.join('\n') || text === 'BLOCK 1' || text === blockLines.join('\n') || text === 'BLOCK 2'),
    [
      { text: 'INTRO-BLOCK 1', type: 'heading', lineNumbers: '36', lineCount: 1 },
      { text: introLines.join('\n'), type: 'codeBlock', lineNumbers: '38', lineCount: 7 },
      { text: 'BLOCK 1', type: 'heading', lineNumbers: '46', lineCount: 1 },
      { text: blockLines.join('\n'), type: 'codeBlock', lineNumbers: '48', lineCount: 16 },
      { text: 'BLOCK 2', type: 'heading', lineNumbers: '66', lineCount: 1 },
    ],
  )
})

for (const source of ['- 항목', '1. 항목', '- [ ] 항목']) {
  test(`목록 뒤 빈 문단 삭제 후 재생성되는 입력 줄은 다음 원문 줄이다: ${source}`, () => {
    const editor = buildEditor(source)
    try {
      editor.commands.setTextSelection(3)
      assert.deepEqual(gutter(editor), ['1', '2'])
      const tail = editor.state.doc.lastChild!
      const tailPos = editor.state.doc.content.size - tail.nodeSize
      editor.view.dispatch(editor.state.tr.delete(tailPos, editor.state.doc.content.size))
      assert.deepEqual(gutter(editor), ['1', '2'])
      const saved = (editor.storage as any).markdown.getMarkdown()
      assert.equal(saved, source + '\n')
      editor.commands.setContent(saved)
      editor.commands.setTextSelection(3)
      assert.deepEqual(gutter(editor), ['1', '2'])
      assert.equal((editor.storage as any).markdown.getMarkdown(), saved)
    } finally { editor.destroy() }
  })
}
