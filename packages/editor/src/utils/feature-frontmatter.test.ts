import test from 'node:test'
import assert from 'node:assert/strict'
import { parse } from 'yaml'
import { featureFilePath, featureReferences, isFeatureDocument, updateFeatureReferences } from './feature-frontmatter.ts'
import { joinFrontmatter, splitFrontmatter } from './frontmatter.ts'

test('feature references use the configured Documents root and project file paths', () => {
  const context = { path: '/work/notes/reference/features/분야/기능.md', docsRoot: '/work/notes/reference', projectRoot: '/work' }
  assert.equal(isFeatureDocument(context), true)
  for (const path of ['/work/notes/reference/features-other/기능.md', '/work/notes/reference/guide.md', '/elsewhere/features/기능.md']) {
    assert.equal(isFeatureDocument({ ...context, path }), false)
  }
  assert.equal(isFeatureDocument({ ...context, projectRoot: undefined }), false)
  assert.equal(featureFilePath('/work', 'src/공백 #100%?.ts'), '/work/src/공백 #100%?.ts')
})

test('feature arrays render valid references while custom types and invalid values retain their editor', () => {
  assert.deepEqual(featureReferences({ key: 'files', value: '["src/app.ts","docs/기능.md"]' }), { kind: 'files', items: ['src/app.ts', 'docs/기능.md'] })
  assert.deepEqual(featureReferences({ key: 'commits', value: '[]' }), { kind: 'commits', items: [] })
  const commits = [{ repository: '', hash: 'abc1234', subject: 'Root commit' }, { repository: 'packages/app', hash: 'def5678' }]
  assert.deepEqual(featureReferences({ key: 'commits', value: JSON.stringify(commits) }), { kind: 'commits', items: commits })
  for (const value of ['["../secret"]', '["https://example.com"]', '["javascript:alert(1)"]', '["/etc/passwd"]', '[42]', '{}', 'invalid']) {
    assert.equal(featureReferences({ key: 'files', value }), null)
  }
  assert.equal(featureReferences({ key: 'commits', value: '[{"repository":"","hash":"bad"}]' }), null)
  assert.equal(featureReferences({ key: 'files', value: '[]', type: 'text' }), null)
})

test('viewing and editing feature references preserve actual YAML arrays and commit objects', () => {
  const header = 'title: Feature\nfiles:\n  - src/app.ts # file comment\ncommits: [{ repository: "", hash: abc1234, subject: First }] # commits comment'
  const data = splitFrontmatter(`---\n${header}\n---\n\nBody`).frontmatter!
  assert.ok(joinFrontmatter(data, 'Changed body').includes(header.slice(header.indexOf('\n') + 1)))
  const files = updateFeatureReferences(data.fields[0], '["src/next.ts"]')
  const commits = updateFeatureReferences(data.fields[1], '[{"repository":"nested","hash":"def5678","subject":"Next"}]')
  const saved = joinFrontmatter({ ...data, fields: [files, commits] }, 'Body')
  assert.deepEqual(parse(saved.split('---')[1]).files, ['src/next.ts'])
  assert.deepEqual(parse(saved.split('---')[1]).commits, [{ repository: 'nested', hash: 'def5678', subject: 'Next' }])
  assert.ok(saved.includes('# commits comment'))
  assert.equal(splitFrontmatter(saved).frontmatter!.fields[1].value, commits.value)
})
