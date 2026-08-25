import assert from 'node:assert/strict'
import test from 'node:test'
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
