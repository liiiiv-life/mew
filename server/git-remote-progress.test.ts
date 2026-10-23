import test from 'node:test'
import assert from 'node:assert/strict'
import { gitProgressParser, type GitRemoteProgress } from '../shared/git-remote-progress.ts'

test('Git progress handles fragmented CR records, stage percentages and excludes raw output', () => {
  const events: GitRemoteProgress[] = []
  const parse = gitProgressParser(progress => events.push(progress))
  parse('secret URL and token\nCounting obj')
  parse('ects:  50% (5/10)\rCounting objects:  50% (6/10)\rCompressing objects: 100% (4/4), done.\nWriting objects: ')
  parse(' 68% (17/25), 4 MiB | 2 MiB/s\rWriting objects: 100% (25/25), done.\nremote: Resolving deltas: 100% (2/2), done.\n')
  assert.deepEqual(events, [
    { phase: 'counting', percent: 50, current: 5, total: 10 },
    { phase: 'compressing', percent: 100, current: 4, total: 4 },
    { phase: 'writing', percent: 68, current: 17, total: 25 },
    { phase: 'writing', percent: 100, current: 25, total: 25 },
    { phase: 'waiting' },
    { phase: 'resolving', percent: 100, current: 2, total: 2 },
  ])
  assert.equal(JSON.stringify(events).includes('secret'), false)
})
