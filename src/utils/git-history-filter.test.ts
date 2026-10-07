import assert from 'node:assert/strict'
import test from 'node:test'
import { filterGitHistory } from './git-history-filter.ts'

const commits = [
  { hash: 'abc123456', parents: [], refs: ['HEAD -> main', 'tag: v1'], subject: 'Fix search 😺', author: 'Alice', email: 'alice@example.com', date: '2026-10-07' },
  { hash: 'def789012', parents: [], refs: ['feature/search'], subject: '패널 작업 1', author: 'Bob', email: 'bob@example.com', date: '2026-10-06' },
  { hash: 'fff012345', parents: [], refs: [], subject: '패널 작업 12', author: 'Alice', email: 'alice@example.com', date: '2026-10-05' },
]
const hashes = (query: string) => filterGitHistory(commits, query).map(commit => commit.hash)

test('commit search matches subjects, authors, hashes and refs without case sensitivity', () => {
  assert.equal(filterGitHistory(commits, '  '), commits)
  assert.deepEqual(hashes('  SEARCH  '), ['abc123456', 'def789012'])
  assert.deepEqual(hashes('ALICE'), ['abc123456', 'fff012345'])
  assert.deepEqual(hashes('7890'), ['def789012'])
  assert.deepEqual(hashes('tag: v1'), ['abc123456'])
  assert.deepEqual(hashes('missing'), [])
})

test('commit wildcards match individual complete fields and Unicode characters', () => {
  assert.deepEqual(hashes('패널 작업 ?'), ['def789012'])
  assert.deepEqual(hashes('패널 작업 ??'), ['fff012345'])
  assert.deepEqual(hashes('ABC*'), ['abc123456'])
  assert.deepEqual(hashes('*search*'), ['abc123456', 'def789012'])
  assert.deepEqual(hashes('Fix search ?'), ['abc123456'])
  assert.deepEqual(hashes('feature/*'), ['def789012'])
  assert.deepEqual(hashes('search*'), [])
  assert.deepEqual(hashes('*Alice*abc*'), [])
  assert.deepEqual(hashes('**'), commits.map(commit => commit.hash))
})
