import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-user-ui-state-'))
process.env.MEW_DATA_DIR = dir

const { readAgentSessionClaims, readAgentTabs, readRootProjects, readWorkspaceUi, writeAgentTabs, writeRootProjects, writeWorkspaceUi } = await import('./userUiState.ts')

test('계정마다 루트 프로젝트 탭과 아이콘을 분리해 영속화한다', () => {
  const saved = writeRootProjects('You@Example.com', {
    paths: ['/work/liiiiv', '/work/ardt'],
    icons: { '/work/liiiiv': 'i:notes', '/work/ardt': '🌱' },
  })
  assert.deepEqual(saved, {
    paths: ['/work/liiiiv', '/work/ardt'],
    icons: { '/work/liiiiv': 'i:notes', '/work/ardt': '🌱' },
  })
  assert.deepEqual(readRootProjects('you@example.com'), saved)
  assert.equal(readRootProjects('other@example.com'), null)
})

test('루트별 에이전트 탭과 ACP 세션 포인터를 계정 상태로 복원한다', () => {
  const saved = writeAgentTabs('you@example.com', '/work/liiiiv', {
    activeId: 'alpha',
    tabs: [{
      id: 'alpha',
      label: '현재 작업',
      runtime: 'codex',
      cwd: '/work/liiiiv',
      sessionIds: { '["codex","/work/liiiiv"]': 'session-123' },
      preset: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: '코드 작업', modelId: 'gpt-5.4', role: '코드를 고친다' },
    }],
  })
  assert.deepEqual(readAgentTabs('you@example.com', '/work/liiiiv'), saved)
  assert.equal(readAgentTabs('you@example.com', '/work/ardt'), null)

  const file = JSON.parse(fs.readFileSync(path.join(dir, 'user-ui-state.json'), 'utf8'))
  assert.equal(file['you@example.com'].agentTabs['/work/liiiiv'].tabs[0].sessionIds['["codex","/work/liiiiv"]'], 'session-123')
  assert.equal(file['you@example.com'].agentTabs['/work/liiiiv'].tabs[0].preset.name, '코드 작업')
})

test('다른 워크스페이스 화면의 숨은 탭까지 세션 점유로 조회한다', () => {
  writeAgentTabs('claims@example.com', '/work/one', {
    tabs: [{ id: 'one', label: 'One', sessionIds: { codex: 'session-one' } }],
    activeId: 'one',
  })
  writeAgentTabs('claims@example.com', '/work/two', {
    tabs: [{ id: 'two', label: 'Two', sessionIds: { codex: 'session-two' } }],
    activeId: 'two',
  })

  assert.deepEqual(readAgentSessionClaims('claims@example.com'), [
    { workspacePath: '/work/one', tabId: 'one', sessionId: 'session-one' },
    { workspacePath: '/work/two', tabId: 'two', sessionId: 'session-two' },
  ])
})

test('작업 화면 상태는 계정·루트 경로별로 분리한다', () => {
  const saved = writeWorkspaceUi('you@example.com', '/work/liiiiv', { sidebar: { docsExpanded: true }, tocOpen: false })
  assert.deepEqual(readWorkspaceUi('you@example.com', '/work/liiiiv'), saved)
  assert.equal(readWorkspaceUi('you@example.com', '/work/other'), null)
  assert.equal(readWorkspaceUi('other@example.com', '/work/liiiiv'), null)
})
