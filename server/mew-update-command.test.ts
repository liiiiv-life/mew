import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const exec = promisify(execFile)

for (const failure of ['', 'git', 'ci', 'build', 'restart']) {
  test(`update pipeline with stub commands: ${failure || 'success'}`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-update-test-'))
    try {
      const original = await fs.readFile(path.join(import.meta.dirname, '../mew'), 'utf8')
      // Exercise the actual update function, replacing process management and all
      // external commands. Never touch the real installation, dist or server.
      const script = original.replace(/running_pid\(\) \{[\s\S]*?(?=create_first_owner\(\))/, `
start_server() { printf 'start\\n' >>"$TEST_TRACE"; [ "$TEST_FAILURE" != restart ]; }
stop_server() { printf 'stop\\n' >>"$TEST_TRACE"; }
`)
      await fs.writeFile(path.join(directory, 'mew'), script)
      await fs.mkdir(path.join(directory, 'bin'))
      await fs.writeFile(path.join(directory, 'bin/git'), '#!/bin/sh\nprintf "git\\n" >>"$TEST_TRACE"\n[ "$TEST_FAILURE" != git ]\n', { mode: 0o700 })
      await fs.writeFile(path.join(directory, 'bin/npm'), '#!/bin/sh\ncase "$1" in ci) stage=ci;; run) stage=build;; *) exit 99;; esac\nprintf "%s\\n" "$stage" >>"$TEST_TRACE"\n[ "$TEST_FAILURE" != "$stage" ]\n', { mode: 0o700 })
      const trace = path.join(directory, 'trace')
      let result: { stdout: string; stderr: string }
      try {
        result = await exec('bash', [path.join(directory, 'mew'), 'update'], { env: { ...process.env, PATH: `${directory}/bin:${process.env.PATH}`, XDG_CONFIG_HOME: `${directory}/config`, TEST_TRACE: trace, TEST_FAILURE: failure } })
        assert.equal(failure, '', 'failed stages must exit nonzero')
      } catch (error) {
        assert.notEqual(failure, '')
        const failed = error as Error & { stdout: string; stderr: string; code: number }
        assert.equal(failed.code, 1)
        result = failed
        assert.match(result.stderr, /failed/)
      }
      const stages = (await fs.readFile(trace, 'utf8')).trim().split('\n')
      const expected = ['git', 'ci', 'build', 'stop', 'start']
      const failedStage = failure === 'restart' ? 'start' : failure
      assert.deepEqual(stages, failure ? expected.slice(0, expected.indexOf(failedStage) + 1) : expected)
      if (failure) assert.doesNotMatch(result.stdout, /updated\./)
      else assert.match(result.stdout, /updated\./)
      if (failure === 'build') assert.match(result.stderr, /server was not restarted/)
    } finally {
      await fs.rm(directory, { recursive: true, force: true })
    }
  })
}
