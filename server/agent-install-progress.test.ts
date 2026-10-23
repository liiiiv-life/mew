import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { RUNTIMES } from './agentRuntimes.ts'
import { installRuntime, runtimeStatuses } from './agentRuntimeInstall.ts'

// 실제 공급자를 설치하지 않고 고정 등록 명령과 실행 파일 판정을 검증한다.
test('installation exposes live stdout/stderr, rejects duplicates, retains failure and resets on retry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-install-progress-'))
  const executable = path.join(dir, 'agent')
  const gate = path.join(dir, 'finish')
  const id = 'progress-fixture'
  let succeed = false
  RUNTIMES[id] = {
    ...RUNTIMES.codex, id,
    spec: () => ({ cmd: executable, args: [] }),
    install: () => ({ cmd: process.execPath, args: ['-e', succeed
      ? `require('fs').writeFileSync(${JSON.stringify(executable)}, 'fixture', {mode:0o755}); console.log('x'.repeat(13000)+'installed')`
      : `console.log('downloading'); console.error('extracting'); const timer=setInterval(()=>{if(require('fs').existsSync(${JSON.stringify(gate)})){clearInterval(timer); console.error('fixture failed'); process.exitCode=1}},20)`] }),
  }
  const status = () => runtimeStatuses().find(item => item.id === id)!
  try {
    const pending = installRuntime(id)
    const rejected = assert.rejects(pending, /fixture failed/)
    try {
      for (let attempt = 0; attempt < 150 && !status().installation?.output.includes('extracting'); attempt++) await delay(20)
      assert.equal(status().installing, true)
      assert.equal(status().installation?.state, 'running')
      assert.match(status().installation!.output, /downloading/)
      assert.match(status().installation!.output, /extracting/)
      await assert.rejects(installRuntime(id), /설치하고 있습니다/)
    } finally { fs.writeFileSync(gate, '') }
    await rejected
    assert.equal(status().installing, false)
    assert.equal(status().installation?.state, 'failed')
    assert.match(status().installation!.output, /fixture failed/)
    succeed = true
    const retry = installRuntime(id)
    assert.equal(status().installation?.output, '')
    const result = await retry
    assert.equal(result.status.installed, true)
    assert.equal(result.status.installing, false)
    assert.equal(status().installation?.state, 'succeeded')
    assert.equal(status().installation!.output.length, 12_000)
    assert.match(status().installation!.output, /installed\n$/)
    assert.equal(status().installation!.output.includes('downloading'), false)
  } finally {
    delete RUNTIMES[id]
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
