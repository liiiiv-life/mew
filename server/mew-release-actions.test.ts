import './test-isolated-data.ts'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'

test('release status and source management actions do not inspect or mutate the source installation', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mew-release-actions-'))
  const previousState = process.env.XDG_STATE_HOME
  const previousDistribution = process.env.MEW_DISTRIBUTION
  process.env.XDG_STATE_HOME = directory
  process.env.MEW_DISTRIBUTION = 'release'
  const jobPath = path.join(directory, 'mew', 'update-job.json')
  const savedJob = JSON.stringify({ state: 'running', startedAt: 1, finishedAt: null, message: null })
  await fs.mkdir(path.dirname(jobPath))
  await fs.writeFile(jobPath, savedJob)
  const { createApiApp, tmuxManager } = await import('./api.ts')
  const list = tmuxManager.list
  const startCommand = tmuxManager.startCommand
  tmuxManager.list = async () => { throw new Error('must not inspect terminal sessions') }
  tmuxManager.startCommand = async () => { throw new Error('must not launch source management commands') }
  const app = express()
  app.use((req, _res, next) => {
    req.auth = { role: 'owner', email: 'release-owner@example.com', mustChangePassword: false }
    next()
  })
  app.use('/api', createApiApp())
  const server = http.createServer(app)
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`
    const statusResponse = await fetch(`${base}/mew-update/status?refresh=1`)
    assert.equal(statusResponse.status, 200)
    const status = await statusResponse.json() as { canUpdate: boolean; supported: boolean; job: unknown; error: string }
    assert.equal(status.canUpdate, false)
    assert.equal(status.supported, false)
    assert.equal(status.job, null)
    assert.match(status.error, /npx @liiiiv\/mew-cli@latest/)
    for (const action of ['build', 'restart', 'update']) {
      const response = await fetch(`${base}/mew-actions/${action}/run`, { method: 'POST' })
      assert.equal(response.status, 409)
      assert.match((await response.json() as { error: string }).error, /npx @liiiiv\/mew-cli@latest/)
    }
    assert.equal(await fs.readFile(jobPath, 'utf8'), savedJob)
  } finally {
    tmuxManager.list = list
    tmuxManager.startCommand = startCommand
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (previousState === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = previousState
    if (previousDistribution === undefined) delete process.env.MEW_DISTRIBUTION
    else process.env.MEW_DISTRIBUTION = previousDistribution
    await fs.rm(directory, { recursive: true, force: true })
  }
})
