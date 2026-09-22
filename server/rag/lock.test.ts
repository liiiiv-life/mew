import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { withRagLock } from './lock.ts'

test('CLI and server serialize index work and recover a dead process lock', { timeout: 10_000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-rag-lock-'))
  try {
    const source = `import {withRagLock} from ${JSON.stringify(new URL('./lock.ts', import.meta.url).href)};await withRagLock(process.argv[1],async()=>{process.stdout.write('locked');await new Promise(r=>process.stdin.once('data',r))})`
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, directory], { stdio: ['pipe', 'pipe', 'pipe'] })
    const exited = once(child, 'exit')
    try {
      await once(child.stdout, 'data')
      let entered = false
      const pending = withRagLock(directory, async () => { entered = true; return 'done' })
      await new Promise(resolve => setTimeout(resolve, 120))
      assert.equal(entered, false)
      child.stdin.end('release')
      assert.deepEqual(await exited, [0, null])
      assert.equal(await pending, 'done')
      fs.writeFileSync(path.join(directory, 'index.lock'), String(child.pid))
      assert.equal(await withRagLock(directory, async () => 'recovered'), 'recovered')
      assert.equal(fs.existsSync(path.join(directory, 'index.lock')), false)
      await assert.rejects(withRagLock(directory, async () => { throw new Error('failed task') }), /failed task/)
      assert.equal(fs.existsSync(path.join(directory, 'index.lock')), false)
    } finally { if (child.exitCode === null) child.kill() }
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
