import assert from 'node:assert/strict'
import test from 'node:test'
import { installRuntime, runtimeStatuses, RuntimeInstallError } from './agentRuntimeInstall.ts'
import { RUNTIMES } from './agentRuntimes.ts'

test('런타임 상태는 서버 등록표 전체를 설치 여부와 함께 내려준다', () => {
  const statuses = runtimeStatuses()
  assert.deepEqual(statuses.map((item) => item.id), Object.keys(RUNTIMES))
  assert.ok(statuses.every((item) => typeof item.installed === 'boolean'))
  assert.ok(statuses.every((item) => item.installable))
})

test('등록표에 없는 id로는 설치 명령을 만들 수 없다', async () => {
  await assert.rejects(installRuntime('../anything'), RuntimeInstallError)
})
