// 각주 동기화 — 마커를 넣고 지울 때 본문 번호와 References 줄이 함께 따라오는지를 실제 에디터로 본다.
// 번호 계산 자체는 utils/footnotes.test.ts가 따로 검증한다. 여기는 그 계획이 문서에 적용되는 경로다.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Window } from 'happy-dom'

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
const { serverEditorExtensions } = await import('../serverExtensions.ts')
const { Footnotes, scanFootnotes } = await import('./footnoteSync.ts')
const { markerFor } = await import('../utils/footnotes.ts')

function makeEditor(content: string) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [...serverEditorExtensions(), Footnotes],
    content,
  })
}

/** 문서를 사람이 읽는 줄 목록으로 — 블록마다 한 줄, 참고문헌 목록은 항목마다 한 줄 */
function lines(editor: InstanceType<typeof Editor>): string[] {
  const out: string[] = []
  editor.state.doc.forEach((node) => {
    if (node.type.name === 'orderedList') node.forEach((item) => out.push(`- ${item.textContent}`))
    else out.push(node.textContent)
  })
  // 스키마가 문서 끝에 붙이는 빈 문단은 셈에서 뺀다
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}

/** 커서를 그 글자 뒤에 두고 Alt+E와 같은 삽입을 시킨다 */
function addFootnoteAfter(editor: InstanceType<typeof Editor>, needle: string) {
  const text = editor.state.doc.textContent
  assert.ok(text.includes(needle), `본문에 '${needle}'이 있어야 한다`)
  // 텍스트 위치 → PM 위치: 첫 문단 기준으로 +1(문단 열림)
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0 || !node.isText || !node.text) return true
    const idx = node.text.indexOf(needle)
    if (idx >= 0) at = pos + idx + needle.length
    return true
  })
  assert.ok(at > 0)
  editor.commands.setTextSelection(at)
  const ok = editor.view.someProp('handleKeyDown', (fn) =>
    fn(editor.view, new window.KeyboardEvent('keydown', { key: 'e', altKey: true, bubbles: true }) as unknown as KeyboardEvent),
  )
  assert.equal(ok, true, 'Alt+E가 처리돼야 한다')
}

test('첫 각주를 달면 References 구역이 생긴다', () => {
  const editor = makeEditor('<p>국내 50~60대 여성 진료 환자 22만명</p>')
  addFootnoteAfter(editor, '22만명')
  assert.deepEqual(lines(editor), [`국내 50~60대 여성 진료 환자 22만명${markerFor(1)}`, 'References', '- '])
  editor.destroy()
})

test('이미 있는 References를 다시 쓴다 — 새로 만들지 않는다', () => {
  const editor = makeEditor('<p>본문 문장</p><h1>References</h1><ol><li><p>먼저 있던 참고문헌</p></li></ol>')
  // 이미 있는 각주 하나(1번)와 짝이 맞는 상태에서 앞쪽에 하나 더 단다
  assert.equal(lines(editor).filter((l) => l === 'References').length, 1)
  addFootnoteAfter(editor, '본문')
  const all = lines(editor)
  assert.equal(all.filter((l) => l === 'References').length, 1, 'References는 하나뿐이어야 한다')
  assert.equal(all[0], `본문${markerFor(1)} 문장`)
  editor.destroy()
})

test('중간에 끼우면 뒤 번호가 내용을 들고 밀린다', () => {
  const editor = makeEditor(
    `<p>가${markerFor(1)} 나${markerFor(2)} 다${markerFor(3)}</p><h1>References</h1><ol><li><p>첫째</p></li><li><p>둘째</p></li><li><p>셋째</p></li></ol>`,
  )
  addFootnoteAfter(editor, `가${markerFor(1)}`) // 1번 마커 **뒤**, 2번 앞
  const all = lines(editor)
  assert.equal(all[0], `가${markerFor(1)}${markerFor(2)} 나${markerFor(3)} 다${markerFor(4)}`)
  assert.deepEqual(all.slice(2), ['- 첫째', '- ', '- 둘째', '- 셋째'])
  editor.destroy()
})

test('마커를 지우면 그 줄이 빠지고 뒤가 당겨진다', () => {
  const editor = makeEditor(
    `<p>가${markerFor(1)} 나${markerFor(2)} 다${markerFor(3)}</p><h1>References</h1><ol><li><p>첫째</p></li><li><p>둘째</p></li><li><p>셋째</p></li></ol>`,
  )
  // 2번 마커만 지운다
  const scan = scanFootnotes(editor.state.doc)
  const second = scan.markers[1]
  editor.view.dispatch(editor.state.tr.delete(second.from, second.to))
  const all = lines(editor)
  assert.equal(all[0], `가${markerFor(1)} 나 다${markerFor(2)}`)
  assert.deepEqual(all.slice(2), ['- 첫째', '- 셋째'], '지운 각주의 줄이 사라지고 뒤가 당겨진다')
  editor.destroy()
})

test('참고문헌 내용은 다시 쓰지 않는다 — 번호 글자만 바뀐다', () => {
  const editor = makeEditor(
    `<p>가${markerFor(1)} 나${markerFor(2)}</p><h1>References</h1><ol><li><p>첫째</p></li><li><p><a href="https://example.com">링크 있는 참고문헌</a></p></li></ol>`,
  )
  addFootnoteAfter(editor, `가${markerFor(1)}`)
  // 2번이던 줄은 3번이 되고, 그 안의 링크 마크는 살아 있어야 한다
  let linkKept = false
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text?.includes('링크 있는') && node.marks.some((m) => m.type.name === 'link')) linkKept = true
    return true
  })
  assert.equal(linkKept, true, '번호만 갈아끼우므로 링크가 살아남는다')
  assert.deepEqual(lines(editor).slice(2), ['- 첫째', '- ', '- 링크 있는 참고문헌'])
  editor.destroy()
})

test('마커가 하나도 없으면 손으로 쓴 References를 건드리지 않는다', () => {
  const editor = makeEditor('<p>각주 없는 본문</p><h1>References</h1><ol><li><p>손으로 쓴 참고문헌</p></li><li><p>또 하나</p></li></ol>')
  editor.view.dispatch(editor.state.tr.insertText('!', 1))
  assert.deepEqual(lines(editor).slice(2), ['- 손으로 쓴 참고문헌', '- 또 하나'])
  editor.destroy()
})

test('References 안의 아래첨자는 마커로 세지 않는다', () => {
  const editor = makeEditor(
    `<p>가${markerFor(1)}</p><h1>References</h1><ol><li><p>원문에도 ${markerFor(9)} 같은 글자가 있을 수 있다</p></li></ol>`,
  )
  const scan = scanFootnotes(editor.state.doc)
  assert.equal(scan.markers.length, 1, '본문 마커만 센다')
  assert.equal(scan.entries.length, 1)
  editor.destroy()
})

test('마크다운 왕복에서 마커와 References가 그대로 남는다', () => {
  // 마커는 그냥 글자라 직렬화기가 따로 알 필요가 없다 — 그게 이 표기를 고른 이유다
  const editor = makeEditor(`<p>본문 22만명${markerFor(1)}</p><h1>References</h1><ol><li><p>통계청 2025</p></li></ol>`)
  const storage = editor.storage as { markdown: { parser: { parse(md: string): unknown }; getMarkdown(): string } }
  const md = storage.markdown.getMarkdown()
  assert.match(md, /22만명₁₎/)
  assert.match(md, /^# References$/m)
  assert.match(md, /^1\. 통계청 2025$/m, '파일에는 표준 순서 목록으로 남는다 — 화면에만 1)로 보인다')

  editor.commands.setContent(storage.markdown.parser.parse(md) as never)
  assert.equal(storage.markdown.getMarkdown().trim(), md.trim(), '다시 넣어도 같아야 한다')
  editor.destroy()
})
