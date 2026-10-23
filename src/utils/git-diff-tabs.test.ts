import test from 'node:test'
import assert from 'node:assert/strict'
import { gitDiffTabPath, gitDiffTarget, type GitDiffTarget } from './git-diff-tabs.ts'

const working: GitDiffTarget = { project: '.workspace', repositoryPath: 'tools/한글 repo', source: { kind: 'working' }, file: { path: 'src/file #?.ts', status: ' M' } }

test('diff tabs retain repository, project, file and source without colliding with file tabs', () => {
  const path = gitDiffTabPath(working)
  assert.deepEqual(gitDiffTarget(path), { project: working.project, repositoryPath: working.repositoryPath, source: working.source, filePath: working.file.path })
  assert.equal(gitDiffTabPath({ ...working, file: { ...working.file, status: 'MM' } }), path, 'status updates retain tab identity')
  for (const changed of [
    { ...working, project: 'docs' },
    { ...working, repositoryPath: '' },
    { ...working, file: { path: 'another.ts', status: '?' } },
    { ...working, source: { kind: 'commit' as const, hash: 'abc123' } },
  ]) assert.notEqual(gitDiffTabPath(changed), path)
  const commit = { ...working, source: { kind: 'commit' as const, hash: 'abc123' } }
  assert.deepEqual(gitDiffTarget(gitDiffTabPath(commit))?.source, commit.source)
  assert.notEqual(gitDiffTabPath(commit), gitDiffTabPath({ ...commit, source: { kind: 'commit', hash: 'def456' } }))
})

test('ordinary file and malformed virtual paths are rejected', () => {
  for (const path of ['README.md', 'mew:git:', 'mew:diff:%', 'mew:diff:null', 'mew:diff:[]', 'mew:diff:' + encodeURIComponent(JSON.stringify(['.workspace', '', 12, 'file.ts']))]) assert.equal(gitDiffTarget(path), null)
})
