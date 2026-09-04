import assert from 'node:assert/strict'
import test from 'node:test'
import { gitRepositoryPath, gitTabLabel, gitTabPath, isGitTabPath } from './gitTabs.ts'

test('Git 워크벤치 가상 탭은 루트와 하위 저장소 경로를 왕복한다', () => {
  const root = gitTabPath('')
  const nested = gitTabPath('apps/한글 repo')
  assert.equal(isGitTabPath(root), true)
  assert.equal(gitRepositoryPath(root), '')
  assert.equal(gitRepositoryPath(nested), 'apps/한글 repo')
  assert.equal(gitTabLabel(root), 'Git')
  assert.equal(gitTabLabel(nested), 'Git · 한글 repo')
  assert.equal(isGitTabPath('README.md'), false)
})
