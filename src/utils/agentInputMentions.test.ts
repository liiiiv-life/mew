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
    .map((option) => [option.label, option.insert, option.insertSuffix])

  assert.deepEqual(shown, [
    ['가방', '[가방]', '\n'],
    ['나무', '[나무]', '\n'],
    ['하위', '[하위]', '\n'],
    ['가이드', '[[mew:가이드]]', undefined],
    ['가.md', '[[mew:가.md]]', undefined],
    ['나.md', '[[mew:나.md]]', undefined],
  ])
})

test('@ 멘션은 마지막 포커스 파일을 하위 프로젝트보다 먼저 보인다', () => {
  const options = agentInputMentionOptions(
    [
      { name: 'med-app', path: 'med-app', type: 'dir', project: true },
      { name: 'notes.md', path: 'notes.md', type: 'file' },
    ],
    'mew',
    [{ name: 'alaaaarm' }],
    'notes.md',
  )

  const shown = options
    .sort((a, b) => (a.sortPriority! - b.sortPriority!) || a.label.localeCompare(b.label, 'ko-KR'))
    .map((option) => [option.label, option.hint, option.insert, option.insertSuffix])

  assert.deepEqual(shown, [
    ['notes.md', 'notes.md', '[[mew:notes.md]]', undefined],
    ['alaaaarm', '하위 프로젝트', '[alaaaarm]', '\n'],
    ['med-app', '하위 프로젝트', '[med-app]', '\n'],
  ])
})
