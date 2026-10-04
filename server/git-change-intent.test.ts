import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { captureCommitChanges } from './git-ai-commit.ts'
import { recordChangeIntent, readMatchingChangeIntents } from './git-change-intent.ts'

test('intent recording preserves stage and verifies before/after objects, including unrelated HEAD advances', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mew-intent-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })
  try {
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'intent@example.test')
    fs.writeFileSync(path.join(cwd, 'a.md'), 'before\n'); git('add', 'a.md'); git('commit', '-qm', 'initial')
    fs.writeFileSync(path.join(cwd, 'a.md'), 'after\n')
    fs.writeFileSync(path.join(cwd, 'outside.md'), 'other task\n'); git('add', 'outside.md')
    const index = git('diff', '--cached'), head = git('rev-parse', 'HEAD')
    const file = await recordChangeIntent(cwd, { purpose: 'clarify policy', files: ['a.md'], verification: 'diff checked' })
    assert.equal(git('diff', '--cached'), index); assert.equal(git('rev-parse', 'HEAD'), head)
    assert.deepEqual((await readMatchingChangeIntents(cwd, await captureCommitChanges(cwd))).map(hint => hint.purpose), ['clarify policy'])
    git('commit', '-qm', 'unrelated change')
    assert.equal((await readMatchingChangeIntents(cwd, await captureCommitChanges(cwd))).length, 1)
    fs.appendFileSync(path.join(cwd, 'a.md'), 'later edit\n')
    assert.deepEqual(await readMatchingChangeIntents(cwd, await captureCommitChanges(cwd)), [])
    await assert.rejects(recordChangeIntent(cwd, { purpose: 'x', files: ['../outside'] }))
    await assert.rejects(recordChangeIntent(cwd, { purpose: 'x', files: ['missing.md'] }))
    fs.writeFileSync(file, '{}')
    assert.deepEqual(await readMatchingChangeIntents(cwd, await captureCommitChanges(cwd)), [])
    // The actual CLI accepts stdin; shell-special names never become commands.
    const strange = "quote' $(touch PWNED).md"
    fs.writeFileSync(path.join(cwd, strange), 'new text\n')
    execFileSync(process.execPath, [path.resolve('server/git-change-intent-cli.ts'), '--cwd', cwd], { input: JSON.stringify({ purpose: 'new doc', files: [strange] }), encoding: 'utf8' })
    assert.equal(fs.existsSync(path.join(cwd, 'PWNED')), false)
    const hints = await readMatchingChangeIntents(cwd, await captureCommitChanges(cwd))
    assert.deepEqual(hints.map(hint => hint.files), [[strange]])
    fs.unlinkSync(path.join(cwd, strange)); fs.writeFileSync(path.join(cwd, 'a.md'), 'new version\n')
    const directory = path.join(cwd, '.git', 'mew-change-intents')
    fs.rmSync(directory, { recursive: true }); fs.symlinkSync(os.tmpdir(), directory)
    assert.deepEqual(await readMatchingChangeIntents(cwd, await captureCommitChanges(cwd)), [])
    await assert.rejects(recordChangeIntent(cwd, { purpose: 'x', files: ['a.md'] }))
  } finally { fs.rmSync(cwd, { recursive: true, force: true }) }
})
