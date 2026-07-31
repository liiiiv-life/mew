// @mew/editor/server 스키마 파리티: 서버 헤드리스 에디터가 Node에서 그래프를 정상 로드하고,
// 대표 마크다운(이미지·오디오·비디오·데이터베이스·표 포함)을 재직렬화해도 churn이 없어야 한다.
// churn이 있으면 협업 병합 때 AI 편집이 문서 전체를 재포맷해 실시간 diff가 엉킨다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

// tiptap/ProseMirror가 전역 DOM을 보도록 happy-dom 셧을 먼저 깐다 (없는 전역만 채움)
const win = new Window({ url: 'http://localhost' })
const w = win as unknown as Record<string, unknown>
for (const k of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement', 'Text', 'DocumentFragment', 'getComputedStyle', 'MutationObserver']) {
  if (k in globalThis) continue
  try {
    ;(globalThis as Record<string, unknown>)[k] = w[k]
  } catch {
    Object.defineProperty(globalThis, k, { value: w[k], configurable: true })
  }
}

const { Editor } = await import('@tiptap/core')
const { Collaboration } = await import('@tiptap/extension-collaboration')
const { serverEditorExtensions } = await import('./serverExtensions.ts')
const Y = await import('yjs')

function buildEditor() {
  const ydoc = new Y.Doc()
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), Collaboration.configure({ document: ydoc, field: 'default' })],
    content: '',
  })
  return { editor, ydoc }
}

const SAMPLE = `# 제목

문단 **굵게** \`code\` [링크](https://x.com).

- 하나
- 둘
  - 중첩

1. 첫째
2. 둘째

\`\`\`ts
const a = 1
\`\`\`

> 인용문

---

![alt text](https://img.example/a.png)

<img src="https://img.example/b.png" alt="w" width="320">

<audio src="https://a.example/x.mp3" controls></audio>

<video src="https://v.example/x.mp4" controls></video>

<div data-mew-db="123e4567-e89b-12d3-a456-426614174000"></div>

| a | b |
| --- | --- |
| 1 | 2 |
`

test('대표 마크다운 라운드트립이 안정적이다(재적용해도 불변)', () => {
  const { editor } = buildEditor()
  const storage = editor.storage as { markdown: { parser: { parse(md: string): unknown }; getMarkdown(): string } }

  editor.commands.setContent(storage.markdown.parser.parse(SAMPLE) as never)
  const out1 = storage.markdown.getMarkdown()
  editor.commands.setContent(storage.markdown.parser.parse(out1) as never)
  const out2 = storage.markdown.getMarkdown()

  assert.equal(out1.trim(), out2.trim(), '한 번 파싱·직렬화한 결과를 다시 넣어도 동일해야 한다')
  editor.destroy()
})

test('커스텀 노드(이미지·오디오·비디오·DB·표)가 전부 살아남는다', () => {
  const { editor } = buildEditor()
  const storage = editor.storage as { markdown: { parser: { parse(md: string): unknown }; getMarkdown(): string } }

  editor.commands.setContent(storage.markdown.parser.parse(SAMPLE) as never)
  const out = storage.markdown.getMarkdown()

  for (const needle of ['![alt text]', 'width="320"', '<audio', '<video', 'data-mew-db="123e4567', '| a | b |']) {
    assert.ok(out.includes(needle), `직렬화 결과에 ${needle}이(가) 없다`)
  }
  editor.destroy()
})
