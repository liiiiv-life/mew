import test from 'node:test'
import assert from 'node:assert/strict'
import { specificationItems, replaceSpecificationItem, presentedSpecificationItems, featureDocumentHref } from './feature-specification.ts'

test('source items preserve headings, nested lists, code, tables and other source bytes', () => {
  const source = '## API\r\n\r\n- POST /login\r\n  - timeout: 30s\r\n- retries: 2\r\n\r\n```ts\r\n- not an item\r\n```\r\n\r\n| Key | Value |\r\n| --- | --- |\r\n| TTL | 30 |\r\n'
  const items = specificationItems(source)
  assert.equal(items.length, 6)
  assert.ok(items[0].heading)
  assert.ok(items[4].text.includes('- not an item'))
  assert.ok(items[5].text.includes('| TTL | 30 |'))
  assert.equal(items.map(item => item.text).join(''), source)
  const item = items[2]
  assert.equal(replaceSpecificationItem(source, item.start, item.end, '  - timeout: 60s'), source.replace('timeout: 30s', 'timeout: 60s'))
  assert.equal(replaceSpecificationItem('- one', 5, 5, '- two'), '- one\n\n- two')
})

test('reading renders Markdown and omits duplicated navigation without changing editable source ranges', () => {
  const source = '# 로그인\n\n### 범위\n\n- **이메일**과 `코드`로 로그인\n  - [계약](../../guides/login.md) 확인\n\n- 상위: [분야 지도](MOC.md) · [상위 기능](../agents.md).\n'
  const items = presentedSpecificationItems(source, ['로그인'])
  assert.equal(items.length, 3)
  assert.equal(items[0].label, '범위')
  assert.match(items[1].html, /<strong>이메일<\/strong>과 <code>코드<\/code>/)
  assert.equal(items[1].label, '이메일과 코드로 로그인')
  assert.equal(items[2].indent, 1)
  assert.match(items[2].html, /<ul>\s*<li><a href="\.\.\/\.\.\/guides\/login.md"/)
  const edited = replaceSpecificationItem(source, items[1].start, items[1].end, '- **전화번호**로 로그인')
  assert.equal(edited, source.replace('- **이메일**과 `코드`로 로그인', '- **전화번호**로 로그인'))
  assert.equal(presentedSpecificationItems(source).length, 4)
  assert.equal(presentedSpecificationItems('- 상위 기능은 자식을 승인하지 않는다.').length, 1)
})

test('rendering keeps code and tables readable and rejects executable Markdown', () => {
  const items = presentedSpecificationItems('```js\nconst a = 1\n```\n\n| 키 | 값 |\n| --- | --- |\n| a | 1 |\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))')
  assert.match(items[0].html, /<pre><code class="language-js">const a = 1/)
  assert.match(items[1].html, /<table>/)
  assert.match(items[2].html, /&lt;script&gt;/)
  assert.ok(items.every(item => !item.html.includes('<script>') && !item.html.includes('href="javascript:')))
  assert.equal(featureDocumentHref('docs/features/agents/input.md', '../../guides/editor.md#기본-편집'), 'docs/guides/editor.md')
  assert.equal(featureDocumentHref('docs/features/login.md', '../../login.ts'), 'login.ts')
  assert.equal(featureDocumentHref('docs/features/login.md', 'https://example.com'), null)
})

test('child navigation candidates are only standalone linked list items', () => {
  const items = presentedSpecificationItems('### 하위 기능\n\n- [입력](agents/input.md#요구사항)\n- [입력](agents/input.md)의 조건을 확인한다.\n- [입력](agents/input.md) · [대화](agents/chat.md)\n\n```md\n- [입력](agents/input.md)\n```')
  assert.deepEqual(items.map(item => item.linkHref), [null, encodeURI('agents/input.md#요구사항'), null, null, null])
  assert.equal(featureDocumentHref('docs/features/agents.md', items[1].linkHref!), 'docs/features/agents/input.md')
})
