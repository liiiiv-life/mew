import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { FeatureStore } from './features.ts'
import { digest, requirementsHash, serializeFeature } from './feature-documents.ts'
import { writeProjectAgentSettings, defaultAgentSettings } from './project-agent-settings.ts'
import type { Feature } from '../shared/features.ts'

const preset = { id: crypto.randomUUID(), name: 'Builder', role: 'Build', runtime: 'codex', modelId: '' }
function fixture(t: test.TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mew-feature-md-'))), workspace = path.join(root, 'project')
  fs.mkdirSync(workspace)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const store = new FeatureStore(path.join(root, 'state'))
  const stateFile = path.join(store.directory, `${digest(workspace)}.json`)
  return { root, workspace, store, stateFile }
}
async function create(store: FeatureStore, workspace: string, title = 'Login') {
  const run = await store.request(workspace, 'owner', { id: crypto.randomUUID(), title, content: 'Requirements', agentSetId: preset.id }, preset)
  await store.claim(workspace)
  const feature = await store.assign(workspace, run.id, { action: 'new', title, content: 'Requirements', reason: 'New' })
  return { run, feature }
}
test('Markdown is canonical, survives clone/rename and preserves custom fields and nested report headings', async t => {
  const { root, workspace, store, stateFile } = fixture(t)
  writeProjectAgentSettings(workspace, defaultAgentSettings('manual'))
  const { run, feature } = await create(store, workspace)
  assert.match(feature.documentPath!, /^manual\/features\/.+\.md$/)
  const doc = path.join(workspace, feature.documentPath!)
  assert.equal(fs.readFileSync(doc, 'utf8').includes('status: implementing'), false)
  const report = { summary: 'Done\n\n## Details\n\n```md\n## 검증\n```', validation: 'Tests passed', files: [], commits: [] }
  await store.report(workspace, run.id, report); await store.finish(workspace, run.id, 'completed')
  let saved = store.read(workspace).features[0]
  assert.equal(saved.report?.summary, report.summary)
  saved = await store.judge(workspace, saved.id, saved.version, 'verified')
  const original = fs.readFileSync(doc, 'utf8')
  const newPath = path.join(path.dirname(doc), 'email-login.md'); fs.renameSync(doc, newPath)
  fs.writeFileSync(newPath, original.replace('title:', '# Keep this comment\nowner: product-team\ncustom:\n  score: 3\ntitle:'))
  let external = store.read(workspace).features[0]
  assert.equal(external.status, 'verified', 'metadata-only edits preserve approval')
  assert.match(external.documentPath!, /email-login.md$/)
  external = await store.edit(workspace, external.id, { ...external, content: 'Revised requirements\n\n## 남은 사항\n- Mobile layout' })
  const written = fs.readFileSync(newPath, 'utf8')
  assert.match(written, /# Keep this comment/); assert.match(written, /owner: product-team/); assert.match(written, /score: 3/)
  assert.equal(external.report?.summary, report.summary)
  await store.judge(workspace, external.id, external.version, 'verified')
  const beforeTouch = store.read(workspace).features[0]
  fs.writeFileSync(newPath, fs.readFileSync(newPath, 'utf8').replaceAll('\n', '\r\n'))
  assert.equal(store.read(workspace).features[0].status, 'verified', 'line ending conversion preserves requirement approval')
  assert.equal(store.read(workspace).features[0].report?.summary.replaceAll('\r\n', '\n'), report.summary)
  fs.writeFileSync(newPath, fs.readFileSync(newPath, 'utf8').replaceAll('\r\n', '\n'))
  fs.utimesSync(newPath, new Date(), new Date())
  assert.equal(store.read(workspace).features[0].status, 'verified')
  assert.equal(store.read(workspace).features[0].version, beforeTouch.version)
  const clone = path.join(root, 'clone'); fs.cpSync(workspace, clone, { recursive: true })
  const cloned = new FeatureStore(path.join(root, 'fresh-server')).read(clone)
  assert.equal(cloned.features[0].id, feature.id); assert.equal(cloned.features[0].status, 'verified')
  assert.equal(cloned.features[0].report?.summary, report.summary); assert.deepEqual(cloned.runs, [])
  const runtime = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  assert.equal(runtime.version, 2); assert.equal('features' in runtime, false); assert.equal('pendingWrites' in runtime, false)
  assert.match(fs.readFileSync(path.join(workspace, 'manual/features/MOC.md'), 'utf8'), /email-login.md/)
})
test('external requirement edits invalidate review, reject stale writes and never start work', async t => {
  const { workspace, store } = fixture(t)
  const { run, feature } = await create(store, workspace)
  const doc = path.join(workspace, feature.documentPath!)
  const initial = fs.readFileSync(doc, 'utf8')
  fs.writeFileSync(doc, initial.replace('Requirements', 'Edited outside mew'))
  const external = store.read(workspace).features[0]
  assert.equal(external.content, 'Edited outside mew'); assert.equal(external.status, 'changed')
  await assert.rejects(store.edit(workspace, feature.id, { ...feature, title: 'Stale GUI title' }), /다른 변경/)
  await store.report(workspace, run.id, { summary: 'Old requirements', files: [], commits: [] })
  await store.finish(workspace, run.id, 'completed')
  assert.equal(store.read(workspace).features[0].status, 'changed')
  assert.equal(store.read(workspace).features[0].report, null)
  assert.equal(store.read(workspace).runs.length, 1)
  assert.match(fs.readFileSync(doc, 'utf8'), /Edited outside mew/)
  fs.unlinkSync(doc)
  assert.deepEqual(store.read(workspace).features, [], 'deleted documents are never resurrected from runtime history')
})
test('legacy JSON migration keeps backup, history and queued version bindings', async t => {
  const { workspace, store, stateFile } = fixture(t)
  fs.mkdirSync(store.directory)
  const feature: Feature = { id: crypto.randomUUID(), title: 'Legacy', content: 'Old spec', parentId: null, status: 'verified', version: 7, createdAt: '2026-01-01', updatedAt: '2026-01-02' }
  const legacy = { version: 1, workspace, revision: 12, features: [feature], runs: [{ id: crypto.randomUUID(), title: 'Old request', featureId: feature.id, featureVersion: 7, state: 'completed', report: { summary: 'Legacy result', validation: 'Checked', files: [], commits: [] } }, { id: crypto.randomUUID(), targetId: feature.id, targetVersion: 7, state: 'queued', featureId: null }] }
  fs.writeFileSync(stateFile, JSON.stringify(legacy))
  await store.prepare(workspace)
  const migrated = store.read(workspace)
  assert.equal(migrated.features[0].status, 'verified'); assert.equal(migrated.features[0].report?.summary, 'Legacy result')
  assert.equal(migrated.runs[1].targetVersion, migrated.features[0].version)
  assert.deepEqual(JSON.parse(fs.readFileSync(`${stateFile}.v1-backup`, 'utf8')), legacy)
  assert.equal('features' in JSON.parse(fs.readFileSync(stateFile, 'utf8')), false)
  const bytes = fs.readFileSync(path.join(workspace, migrated.features[0].documentPath!), 'utf8')
  await store.prepare(workspace)
  assert.equal(fs.readFileSync(path.join(workspace, migrated.features[0].documentPath!), 'utf8'), bytes)
})
test('malformed documents, duplicates, hierarchy cycles and symlinks fail without overwriting', async t => {
  const { root, workspace, store } = fixture(t)
  const { feature } = await create(store, workspace)
  const doc = path.join(workspace, feature.documentPath!), raw = fs.readFileSync(doc, 'utf8')
  fs.writeFileSync(doc, raw.replace('parent: null', `parent: ${feature.id}`))
  assert.throws(() => store.read(workspace), /순환/)
  fs.writeFileSync(doc, raw.replace('parent: null', 'parent: absent'))
  assert.throws(() => store.read(workspace), /상위 기능 absent/)
  fs.writeFileSync(doc, raw.replace('title: Login', 'title: [broken'))
  const broken = fs.readFileSync(doc, 'utf8')
  await assert.rejects(store.edit(workspace, feature.id, feature))
  assert.equal(fs.readFileSync(doc, 'utf8'), broken)
  fs.writeFileSync(doc, raw)
  const duplicate = path.join(path.dirname(doc), 'duplicate.md'); fs.writeFileSync(duplicate, raw)
  assert.throws(() => store.read(workspace), /중복 ID/)
  fs.unlinkSync(duplicate)
  const outside = path.join(root, 'outside.md'); fs.writeFileSync(outside, raw); fs.symlinkSync(outside, duplicate)
  assert.throws(() => store.read(workspace), /심볼릭 링크/)
  fs.unlinkSync(duplicate)
  fs.renameSync(path.dirname(doc), path.join(root, 'moved-features')); fs.symlinkSync(path.join(root, 'moved-features'), path.dirname(doc))
  assert.throws(() => store.read(workspace), /심볼릭 링크/)
})
test('interrupted transactions recover idempotently and preserve conflicting external changes', async t => {
  const { workspace, store, stateFile } = fixture(t)
  const { feature } = await create(store, workspace)
  const doc = path.join(workspace, feature.documentPath!), original = fs.readFileSync(doc, 'utf8')
  const next = serializeFeature({ ...feature, title: 'Recovered', status: 'verified' })
  const runtime = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  runtime.pendingWrites = [{ path: feature.documentPath, before: digest(original), content: next }]
  fs.writeFileSync(stateFile, JSON.stringify(runtime)); fs.writeFileSync(doc, next)
  await store.prepare(workspace)
  assert.equal(store.read(workspace).features[0].title, 'Recovered')
  assert.equal('pendingWrites' in JSON.parse(fs.readFileSync(stateFile, 'utf8')), false)
  runtime.pendingWrites[0] = { path: feature.documentPath, before: digest(next), content: original }
  fs.writeFileSync(stateFile, JSON.stringify(runtime)); fs.writeFileSync(doc, next.replace('Recovered', 'External'))
  await assert.rejects(store.prepare(workspace), /충돌/)
  assert.match(fs.readFileSync(doc, 'utf8'), /External/)
})
test('handwritten Markdown is discovered with stable IDs and requirements hash review binding', t => {
  const { workspace, store } = fixture(t), dir = path.join(workspace, 'docs/features')
  fs.mkdirSync(dir, { recursive: true })
  const manual = { id: 'email-login', title: 'Email login', parentId: null, content: 'Use email.' }
  fs.writeFileSync(path.join(dir, 'email-login.md'), `---\nid: email-login\ntitle: Email login\nstatus: verified\nstatus_hash: ${requirementsHash(manual)}\ncreated: 2026-09-17\nupdated: 2026-09-17\n---\n\n## 요구사항\n\nUse email.\n\n## 구현 내용\n\nEmail form.\n\n## 검증\n\nTests pass.\n`)
  const feature = store.read(workspace).features[0]
  assert.equal(feature.id, 'email-login'); assert.equal(feature.status, 'verified'); assert.equal(feature.report?.summary, 'Email form.')
  assert.deepEqual(store.read(workspace).runs, [])
})
