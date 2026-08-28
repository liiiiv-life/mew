import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bringMobilePanelToFront,
  closeMobilePanel,
  selectMobilePanel,
  type WorkspacePanelId,
} from './mobile-panel-stack.ts'

test('뒤에 열린 패널은 종류와 관계없이 닫지 않고 전면으로 가져온다', () => {
  let stack: WorkspacePanelId[] = []

  let selected = selectMobilePanel(stack, 'agent', false)
  stack = selected.stack
  assert.deepEqual(selected, { open: true, stack: ['agent'] })

  selected = selectMobilePanel(stack, 'terminal', false)
  stack = selected.stack
  assert.deepEqual(selected, { open: true, stack: ['agent', 'terminal'] })

  selected = selectMobilePanel(stack, 'agent', true)
  assert.deepEqual(selected, { open: true, stack: ['terminal', 'agent'] })
})

test('전면 패널을 다시 선택할 때만 닫고 바로 아래 패널을 드러낸다', () => {
  const selected = selectMobilePanel<WorkspacePanelId>(['sidebar', 'browser', 'agentSet'], 'agentSet', true)
  assert.deepEqual(selected, { open: false, stack: ['sidebar', 'browser'] })
})

test('새 패널도 공통 함수만으로 전면 이동과 외부 닫기를 처리한다', () => {
  const withFuturePanel = bringMobilePanelToFront(['sidebar', 'future-panel'], 'sidebar')
  assert.deepEqual(withFuturePanel, ['future-panel', 'sidebar'])
  assert.deepEqual(closeMobilePanel(withFuturePanel, 'sidebar'), ['future-panel'])
})
