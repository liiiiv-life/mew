import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
test('update worker runs a non-executable script with the server Node and records completion', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-update-worker-'))
  try {
    const original = await fs.readFile(path.join(import.meta.dirname, 'runMewUpdate.ts'), 'utf8')
    const fixture = original.replace("import './config.ts'", '').replace("from './mewUpdate.ts'", "from './fixture.ts'")
    await fs.writeFile(path.join(directory, 'worker.ts'), fixture)
    await fs.writeFile(path.join(directory, 'fixture.ts'), `import fs from 'node:fs';import path from 'node:path';export const MEW_APP_ROOT=${JSON.stringify(directory)};export const writeMewUpdateJob=job=>fs.writeFileSync(path.join(MEW_APP_ROOT,'job.json'),JSON.stringify(job));`)
    await fs.writeFile(path.join(directory, 'mew'), '#!/bin/bash\nprintf "%s\\n" "$MEW_NODE"\ncommand -v node\n', { mode: 0o600 })
    const { stdout } = await exec(process.execPath, [path.join(directory, 'worker.ts')])
    assert.deepEqual(stdout.trim().split('\n'), [process.execPath, path.join(path.dirname(process.execPath), 'node')])
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'job.json'), 'utf8')).state, 'succeeded')
    await fs.writeFile(path.join(directory, 'mew'), '#!/bin/bash\nprintf "fixture failure\\n" >&2\nexit 7\n')
    await assert.rejects(exec(process.execPath, [path.join(directory, 'worker.ts')]))
    const job = JSON.parse(await fs.readFile(path.join(directory, 'job.json'), 'utf8'))
    assert.equal(job.state, 'failed')
    assert.match(job.message, /fixture failure/)
  } finally { await fs.rm(directory, { recursive: true, force: true }) }
})
