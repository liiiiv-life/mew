import assert from 'node:assert/strict'
import test from 'node:test'
import { detectInitialProject, WORKSPACE_PROJECT } from './active-project.ts'

test('마지막 화면이 홈이면 .workspace를 복원한다', () => {
  assert.equal(detectInitialProject('/', WORKSPACE_PROJECT), WORKSPACE_PROJECT)
})

test('옛 프로젝트 URL은 저장된 홈보다 우선한다', () => {
  assert.equal(detectInitialProject('/mew', WORKSPACE_PROJECT), 'mew')
})

test('일반 프로젝트 저장값은 복원하고 잘못된 값은 docs로 물러난다', () => {
  assert.equal(detectInitialProject('/', 'along'), 'along')
  assert.equal(detectInitialProject('/', '../outside'), 'docs')
  assert.equal(detectInitialProject('/%E0%A4%A', null), 'docs')
})
