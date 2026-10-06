import { parseDocument } from 'yaml'
import './test-isolated-data.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { FeatureStore } from './features.ts'
import { digest, requirementsHash, serializeFeature, parseFeatureDocument, readFeatureDocuments } from './feature-documents.ts'
import { DocumentPages } from './document-pages.ts'
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
  assert.equal(external.title, 'email-login', 'the filename owns the feature title')
  assert.equal(external.status, 'changed', 'renaming changes the reviewed title')
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
  assert.equal(fs.existsSync(path.join(workspace, 'manual/features/MOC.md')), false, 'feature changes do not create an index document')
  assert.equal(fs.existsSync(path.join(workspace, 'manual/MOC.md')), false)
  assert.equal(parseDocument(original.split('---')[1]).get('description'), `기능: ${feature.title}`)
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
test('folder hierarchy ignores obsolete parent metadata; malformed YAML, duplicate IDs and symlinks fail without overwriting', async t => {
  const { root, workspace, store } = fixture(t)
  const { feature } = await create(store, workspace)
  const doc = path.join(workspace, feature.documentPath!), raw = fs.readFileSync(doc, 'utf8')
  fs.writeFileSync(doc, raw.replace('parent: null', `parent: ${feature.id}`))
  assert.equal(store.read(workspace).features[0].parentId, null)
  fs.writeFileSync(doc, raw.replace('parent: null', 'parent: absent'))
  assert.equal(store.read(workspace).features[0].parentId, null)
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
  const next = serializeFeature({ ...feature, content: 'Recovered', status: 'verified' })
  const runtime = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  runtime.pendingWrites = [{ path: feature.documentPath, before: digest(original), content: next }]
  fs.writeFileSync(stateFile, JSON.stringify(runtime)); fs.writeFileSync(doc, next)
  await store.prepare(workspace)
  assert.equal(store.read(workspace).features[0].content, 'Recovered')
  assert.equal('pendingWrites' in JSON.parse(fs.readFileSync(stateFile, 'utf8')), false)
  runtime.pendingWrites[0] = { path: feature.documentPath, before: digest(next), content: original }
  fs.writeFileSync(stateFile, JSON.stringify(runtime)); fs.writeFileSync(doc, next.replace('Recovered', 'External'))
  await assert.rejects(store.prepare(workspace), /충돌/)
  assert.match(fs.readFileSync(doc, 'utf8'), /External/)
})
test('handwritten Markdown is discovered with stable IDs and requirements hash review binding', t => {
  const { workspace, store } = fixture(t), dir = path.join(workspace, 'docs/features')
  fs.mkdirSync(dir, { recursive: true })
  const manual = { id: 'email-login', title: 'email-login', parentId: null, content: 'Use email.' }
  fs.writeFileSync(path.join(dir, 'email-login.md'), `---\nid: email-login\ntitle: Email login\nstatus: verified\nstatus_hash: ${requirementsHash(manual)}\ncreated: 2026-09-17\nupdated: 2026-09-17\n---\n\n## 요구사항\n\nUse email.\n\n## 구현 내용\n\nEmail form.\n\n## 검증\n\nTests pass.\n`)
  const feature = store.read(workspace).features[0]
  assert.equal(feature.id, 'email-login'); assert.equal(feature.status, 'verified'); assert.equal(feature.report?.summary, 'Email form.')
  assert.deepEqual(store.read(workspace).runs, [])
})

test('ordinary Markdown and flexible result markers never prevent reading the feature tree', t => {
  const { workspace, store } = fixture(t), dir = path.join(workspace, 'docs/features')
  fs.mkdirSync(dir, { recursive: true })
  const plain = '# 본문 제목\n\n일반 문서\n\n```md\n<!-- mew:implementation:start -->\n## 구현 내용\n예시\n<!-- mew:implementation:end -->\n```\n\n<!-- mew:validation:start -->\n불완전한 구분자도 본문이다.\n'
  fs.writeFileSync(path.join(dir, '일반 항목.md'), plain)
  fs.writeFileSync(path.join(dir, '보고.md'), '<!-- mew:implementation:start -->\n\n- 제목 앞 메모\n## 구현 내용\n\n구현 결과\n<!-- mew:implementation:end -->\n\n<!-- mew:validation:start -->\n\n## 검증\n\n완료\n<!-- mew:validation:end -->\n')
  const features = store.read(workspace).features
  assert.equal(features.length, 2)
  const ordinary = features.find(feature => feature.title === '일반 항목')!
  assert.equal(ordinary.content, plain.trim()); assert.equal(ordinary.report, null)
  assert.equal(ordinary.status, 'changed')
  assert.equal(store.read(workspace).features.find(feature => feature.title === '일반 항목')!.id, ordinary.id)
  assert.match(features.find(feature => feature.title === '보고')!.report!.summary, /제목 앞 메모[\s\S]*구현 결과/)
  assert.equal(parseFeatureDocument('docs/features/중복.md', '## 검증\n첫 번째\n## 검증\n두 번째', '').feature.report!.validation, '첫 번째\n\n두 번째')
})

test('feature API promotes, renames and demotes nested pages with links and run versions preserved', async t => {
  const { workspace, store } = fixture(t)
  const { run, feature: parent } = await create(store, workspace, '상위')
  await store.report(workspace, run.id, { summary: '완료', files: [], commits: [] }); await store.finish(workspace, run.id, 'completed')
  fs.writeFileSync(path.join(workspace, 'docs/링크.md'), '[상위](features/상위.md)')
  const childRun = await store.request(workspace, 'owner', { id: crypto.randomUUID(), title: '하위', content: '[상위](../상위.md)', agentSetId: preset.id, parentId: parent.id }, preset)
  await store.claim(workspace)
  const child = await store.assign(workspace, childRun.id, { action: 'child', title: '하위', content: childRun.content, parentId: parent.id, reason: '하위' })
  let data = store.read(workspace)
  assert.equal(data.features.find(feature => feature.id === parent.id)!.documentPath, 'docs/features/상위/_상위.md')
  assert.equal(child.documentPath, 'docs/features/상위/하위.md')
  assert.equal(fs.existsSync(path.join(workspace, 'docs/features/상위.md')), false)
  assert.match(fs.readFileSync(path.join(workspace, 'docs/링크.md'), 'utf8'), /features\/%EC%83%81%EC%9C%84\/_%EC%83%81%EC%9C%84.md/)
  const current = data.features.find(feature => feature.id === parent.id)!
  await store.edit(workspace, parent.id, { ...current, title: '새 상위' })
  data = store.read(workspace)
  assert.equal(data.features.find(feature => feature.id === parent.id)!.documentPath, 'docs/features/새 상위/_새 상위.md')
  const moved = data.features.find(feature => feature.id === child.id)!
  assert.equal(moved.documentPath, 'docs/features/새 상위/하위.md')
  assert.equal(data.runs.find(run => run.id === childRun.id)!.featureVersion, moved.version)
  await store.edit(workspace, child.id, { ...moved, parentId: null })
  data = store.read(workspace)
  assert.equal(data.features.find(feature => feature.id === parent.id)!.documentPath, 'docs/features/새 상위.md')
  assert.equal(data.features.find(feature => feature.id === child.id)!.documentPath, 'docs/features/하위.md')
  assert.equal(fs.existsSync(path.join(workspace, 'docs/features/새 상위')), false)
  const names = data.features.map(feature => feature.documentPath).sort()
  await assert.rejects(store.edit(workspace, child.id, { ...data.features.find(feature => feature.id === child.id)!, title: '새 상위' }), /같은 이름/)
  assert.deepEqual(store.read(workspace).features.map(feature => feature.documentPath).sort(), names)
})

test('Documents create, move and final-child delete are reflected without metadata or automatic work', t => {
  const { workspace, store } = fixture(t), docsRoot = path.join(workspace, 'docs')
  fs.mkdirSync(path.join(docsRoot, 'features'), { recursive: true })
  fs.writeFileSync(path.join(docsRoot, 'features/상위.md'), '# 원본\n본문')
  const pages = new DocumentPages(docsRoot)
  pages.create('features/상위.md', '하위')
  let features = store.read(workspace).features
  const parent = features.find(feature => feature.title === '상위')!, child = features.find(feature => feature.title === '하위')!
  assert.equal(parent.documentPath, 'docs/features/상위/_상위.md'); assert.equal(child.parentId, parent.id)
  assert.equal(features.length, 2)
  pages.delete('features/상위/하위.md')
  features = store.read(workspace).features
  assert.equal(features.length, 1); assert.equal(features[0].documentPath, 'docs/features/상위.md')
  assert.equal(fs.existsSync(path.join(docsRoot, 'features/상위')), false)
  assert.equal(fs.readFileSync(path.join(docsRoot, 'features/상위.md'), 'utf8'), '# 원본\n본문')
  assert.deepEqual(store.read(workspace).runs, [])
  assert.equal(readFeatureDocuments(workspace, 'docs').size, 1)
})

test('parent renames preserve binary attachments, hidden files and manual MOC links; attachments prevent demotion', async t => {
  const { workspace, store } = fixture(t), docsRoot = path.join(workspace, 'docs')
  fs.mkdirSync(path.join(docsRoot, 'features'), { recursive: true })
  fs.writeFileSync(path.join(docsRoot, 'features/부모.md'), '# 본문\n\n![그림](./그림.bin)')
  const pages = new DocumentPages(docsRoot)
  pages.create('features/부모.md', '자식')
  const bytes = Buffer.from([0, 255, 128, 64, 1])
  fs.writeFileSync(path.join(docsRoot, 'features/부모/그림.bin'), bytes)
  fs.writeFileSync(path.join(docsRoot, 'features/부모/.메모'), '숨김')
  fs.writeFileSync(path.join(docsRoot, 'features/MOC.md'), '# 사용자 지도\n\n[부모](부모/_부모.md)')
  const parent = store.read(workspace).features.find(feature => feature.title === '부모')!
  await store.edit(workspace, parent.id, { ...parent, title: '새 부모' })
  assert.deepEqual(fs.readFileSync(path.join(docsRoot, 'features/새 부모/그림.bin')), bytes)
  assert.equal(fs.readFileSync(path.join(docsRoot, 'features/새 부모/.메모'), 'utf8'), '숨김')
  assert.equal(fs.existsSync(path.join(docsRoot, 'features/부모')), false)
  assert.match(fs.readFileSync(path.join(docsRoot, 'features/MOC.md'), 'utf8'), /\[부모\]\(%EC%83%88%20%EB%B6%80%EB%AA%A8\/_%EC%83%88%20%EB%B6%80%EB%AA%A8.md\)/)
  const child = store.read(workspace).features.find(feature => feature.title === '자식')!
  await store.edit(workspace, child.id, { ...child, parentId: null })
  assert.equal(store.read(workspace).features.find(feature => feature.id === parent.id)!.documentPath, 'docs/features/새 부모/_새 부모.md')
  assert.deepEqual(fs.readFileSync(path.join(docsRoot, 'features/새 부모/그림.bin')), bytes)
})

test('interrupted attachment moves recover without overwriting external changes', async t => {
  const { workspace, store, stateFile } = fixture(t)
  await create(store, workspace)
  const old = 'docs/features/old.bin', next = 'docs/features/next.bin', bytes = Buffer.from([0, 254, 1])
  fs.writeFileSync(path.join(workspace, old), bytes)
  const runtime = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  runtime.pendingWrites = [{ path: next, moveFrom: old, before: digest(bytes), content: null }]
  fs.writeFileSync(stateFile, JSON.stringify(runtime))
  fs.renameSync(path.join(workspace, old), path.join(workspace, next))
  await store.prepare(workspace)
  assert.deepEqual(fs.readFileSync(path.join(workspace, next)), bytes)
  assert.equal('pendingWrites' in JSON.parse(fs.readFileSync(stateFile, 'utf8')), false)
  fs.renameSync(path.join(workspace, next), path.join(workspace, old))
  fs.writeFileSync(path.join(workspace, old), Buffer.from([1, 2, 3]))
  fs.writeFileSync(stateFile, JSON.stringify(runtime))
  await assert.rejects(store.prepare(workspace), /충돌/)
  assert.deepEqual(fs.readFileSync(path.join(workspace, old)), Buffer.from([1, 2, 3]))
  assert.equal(fs.existsSync(path.join(workspace, next)), false)
})
