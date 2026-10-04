import test from 'node:test'
import assert from 'node:assert/strict'
import { gitOriginLink } from './git-origin-link.ts'

test('origin links support Git transports and omit credentials', () => {
  for (const remote of ['git@github.com:owner/repo.git', 'ssh://git@github.com/owner/repo.git', 'git://github.com/owner/repo.git', 'https://user:secret@github.com/owner/repo.git?token=secret#ref']) {
    assert.equal(gitOriginLink(remote), 'https://github.com/owner/repo')
  }
  assert.equal(gitOriginLink('https://gitlab.com/group/repo.git'), 'https://gitlab.com/group/repo')
  for (const remote of [undefined, '', '/local/repo.git', 'file:///local/repo', 'javascript:alert(1)']) assert.equal(gitOriginLink(remote), null)
})
