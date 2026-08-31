import assert from 'node:assert/strict'
import test from 'node:test'
import { agentInputMentionOptions } from './agentInputMentions.ts'

test('@ 멘션은 하위 프로젝트, 폴더, 파일 순으로 가나다 정렬한다', () => {
  const options = agentInputMentionOptions(
    [
      { name: '하위', path: '하위', type: 'dir', project: true },
      { name: '가이드', path: '가이드', type: 'dir' },
      { name: '나.md', path: '나.md', type: 'file' },
      { name: '가.md', path: '가.md', type: 'file' },
    ],
    'mew',
    [{ name: '나무' }, { name: '가방' }],
  )

  const shown = options
    .sort((a, b) => (a.sortPriority! - b.sortPriority!) || a.label.localeCompare(b.label, 'ko-KR'))
    .map((option) => [option.label, option.insert])

  assert.deepEqual(shown, [
    ['가방', '#가방'],
    ['나무', '#나무'],
    ['하위', '[[mew:하위]]'],
    ['가이드', '[[mew:가이드]]'],
    ['가.md', '[[mew:가.md]]'],
    ['나.md', '[[mew:나.md]]'],
  ])
})
