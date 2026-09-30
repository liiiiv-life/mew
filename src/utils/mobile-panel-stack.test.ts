import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bringMobilePanelToFront,
  closeMobilePanel,
  restoreMobilePanelStack,
  selectMobilePanel,
  type WorkspacePanelId,
} from './mobile-panel-stack.ts'

test('뒤에 열린 패널은 종류와 관계없이 닫지 않고 전면으로 가져온다', () => {
  let stack: WorkspacePanelId[] = []

  let selected = selectMobilePanel(stack, 'agent', false)
  stack = selected.stack
  assert.deepEqual(selected, { open: true, stack: ['agent'] })

  selected = selectMobilePanel(stack, 'browser', false)
  stack = selected.stack
  assert.deepEqual(selected, { open: true, stack: ['agent', 'browser'] })

  selected = selectMobilePanel(stack, 'agent', true)
  assert.deepEqual(selected, { open: true, stack: ['browser', 'agent'] })
})

test('전면 패널을 다시 선택할 때만 닫고 바로 아래 패널을 드러낸다', () => {
  const selected = selectMobilePanel<WorkspacePanelId>(['sidebar', 'browser', 'agent'], 'agent', true)
  assert.deepEqual(selected, { open: false, stack: ['sidebar', 'browser'] })
})

test('새 패널도 공통 함수만으로 전면 이동과 외부 닫기를 처리한다', () => {
  const withFuturePanel = bringMobilePanelToFront(['sidebar', 'future-panel'], 'sidebar')
  assert.deepEqual(withFuturePanel, ['future-panel', 'sidebar'])
  assert.deepEqual(closeMobilePanel(withFuturePanel, 'sidebar'), ['future-panel'])
})

test('Git은 전면 전환·뒤로가기·복원에 다른 작업 패널과 함께 참여한다', () => {
  const open = { sidebar: false, chat: false, agent: true, terminal: false, browser: false, android: false, git: true, features: false, tasks: false }
  assert.deepEqual(restoreMobilePanelStack(open, 'git'), ['agent', 'git'])
  assert.deepEqual(selectMobilePanel(['git', 'agent'], 'git', true), { open: true, stack: ['agent', 'git'] })
  assert.deepEqual(closeMobilePanel(['agent', 'git'], 'git'), ['agent'])
})

test('복원 때 마지막 전면 창을 열린 창들보다 앞에 둔다', () => {
  assert.deepEqual(
    restoreMobilePanelStack({ terminal: false, sidebar: true, chat: false, agent: true, browser: true, android: false, git: false, features: false, tasks: false }, 'agent'),
    ['sidebar', 'browser', 'agent'],
  )
  assert.deepEqual(
    restoreMobilePanelStack({ terminal: false, sidebar: true, chat: false, agent: false, browser: false, android: false, git: false, features: false, tasks: false }, 'agent'),
    ['sidebar'],
  )
})

test('에디터가 전면이었던 상태는 열린 보조 패널이 있어도 빈 스택으로 복원한다', () => {
  assert.deepEqual(
    restoreMobilePanelStack({ terminal: false, sidebar: true, chat: false, agent: true, browser: false, android: false, git: false, features: false, tasks: false }, 'editor'),
    [],
  )
})

test('에이전트와 터미널은 독립적으로 전면 전환·복원한다', () => {
  const open = { sidebar: false, chat: false, agent: true, terminal: true, browser: false, android: false, git: false, features: false, tasks: false }
  assert.deepEqual(restoreMobilePanelStack(open, 'terminal'), ['agent', 'terminal'])
  assert.deepEqual(selectMobilePanel(['agent', 'terminal'], 'agent', true), { open: true, stack: ['terminal', 'agent'] })
})
