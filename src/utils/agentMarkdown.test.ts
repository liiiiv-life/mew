import assert from 'node:assert/strict'
import test from 'node:test'
import MarkdownIt from 'markdown-it'
import { isAgentWorkspaceHref, renderMarkdown } from './agentMarkdown.ts'

test('워크스페이스 경로와 외부 링크를 가른다', () => {
  assert.equal(isAgentWorkspaceHref('/home/me/work/app.ts:12'), true)
  assert.equal(isAgentWorkspaceHref('app/src/main.ts#L4'), true)
  assert.equal(isAgentWorkspaceHref('file:///home/me/work/app.ts:12'), true)
  assert.equal(isAgentWorkspaceHref('https://example.com'), false)
  assert.equal(isAgentWorkspaceHref('ftp://example.com/file'), false)
  assert.equal(isAgentWorkspaceHref('#section'), false)
})

test('에이전트 마크다운은 링크를 클릭 가능한 앵커로 그린다', () => {
  const html = renderMarkdown('[파일](/home/me/work/app.ts:12)')
  assert.match(html, /href="\/home\/me\/work\/app\.ts:12"/)
  assert.match(html, /target="_blank"/)
})

test('streaming cache churn retains hot answers and skips oversized cache entries', t => {
  const render = t.mock.method(MarkdownIt.prototype, 'render')
  const hot = '자주 여는 **답변**'
  for (let i = 0; i < 220; i++) {
    renderMarkdown(hot)
    renderMarkdown(`스트리밍 청크 ${i}`)
  }
  assert.equal(render.mock.calls.filter(call => call.arguments[0] === hot).length, 1)
  const large = 'large-answer '.repeat(50_000)
  assert.equal(renderMarkdown(large), renderMarkdown(large))
  assert.equal(render.mock.calls.filter(call => call.arguments[0] === large).length, 2)
})

test('cached agent Markdown still escapes raw HTML and unsafe links', () => {
  const text = '<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))'
  const html = renderMarkdown(text)
  assert.doesNotMatch(html, /<script|href="javascript:/)
  assert.match(html, /&lt;script&gt;/)
  assert.equal(renderMarkdown(text), html)
})

test('memoized Markdown keeps translated code controls and each table copy source', () => {
  const text = '```js\nconst value = 1\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n| C | D |\n| - | - |\n| 3 | 4 |'
  const korean = renderMarkdown(text, 'ko')
  const english = renderMarkdown(text, 'en')
  assert.match(korean, /aria-label="코드 복사"/)
  assert.doesNotMatch(english, /aria-label="코드 복사"/)
  assert.match(korean, /data-mew-copy="const value = 1/)
  assert.match(korean, /data-mew-copy="\| A \| B \|\n\| - \| - \|\n\| 1 \| 2 \|"/)
  assert.match(korean, /data-mew-copy="\| C \| D \|\n\| - \| - \|\n\| 3 \| 4 \|"/)
  assert.equal(renderMarkdown(text, 'ko'), korean)
})
