import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ensureExecutableHelper } from './pty-helper.ts'

test('repairs the macOS tarball mode without granting group/world execution', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mew-pty-helper-'))
  const helper = path.join(dir, 'spawn-helper')
  try {
    writeFileSync(helper, '')
    chmodSync(helper, 0o644)
    ensureExecutableHelper(helper)
    assert.equal(statSync(helper).mode & 0o777, 0o744)
    ensureExecutableHelper(helper)
    assert.equal(statSync(helper).mode & 0o777, 0o744)
    chmodSync(helper, 0o755)
    ensureExecutableHelper(helper)
    assert.equal(statSync(helper).mode & 0o777, 0o755)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('missing helper remains an actionable startup failure', () => {
  assert.throws(() => ensureExecutableHelper('/nonexistent-mew-pty-helper/spawn-helper'), { code: 'ENOENT' })
})
