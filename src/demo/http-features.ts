import type { Feature, FeatureReport, FeatureRun, FeatureWorkspace } from '../../shared/features.ts'
import type { BranchFeature, BranchFeaturePatch, BranchFeatureSnapshot } from '../../shared/branch-features.ts'
import { validPreviewPort } from '../../shared/port-preview.ts'
import { representativeName, rewritePageLinks, remapPagePath, type DocumentPageMove } from '../../shared/document-pages.ts'
import { DEMO_USER } from './fixtures.ts'
import { demoDocument, demoDocumentHash, demoFilename, demoWorkspaceFiles, loadDemoWorkspaceDocuments, requireDemoWorkspace } from './document-utils.ts'
import { demoJson, requireMethod, stringField, type DemoHttpHandler } from './http.ts'
import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'

const parent = (path: string) => path.slice(0, path.lastIndexOf('/'))
const basename = (path: string) => path.split('/').at(-1)!
const featureName = (path: string) => basename(path) === representativeName(parent(path)) || ['MOC.md', '_MOC.md'].includes(basename(path)) ? basename(parent(path)) : basename(path).replace(/\.md$/i, '')
const runsKey = (workspace: string) => `features:${workspace}:runs`
const branchesKey = (workspace: string) => `features:${workspace}:branches`

export function readDemoBranchFeatures(store: DemoWorkspaceStore, workspace: string): BranchFeatureSnapshot {
  const currentBranch = store.gitRepository().branch, commit = store.gitLog().commits[0]
  const metadata = store.getState<Record<string, Partial<BranchFeature>>>(branchesKey(workspace), {})
  const names = [...new Set([...store.gitBranches().branches.map(item => item.name), 'feat/search', 'feat/theme'])]
  const branches: BranchFeature[] = names.map(branch => {
    const current = branch === currentBranch, sample = ['feat/search', 'feat/theme'].includes(branch)
    const worktreePath = current ? workspace : sample ? `${workspace}/.worktrees/${branch.slice(5)}` : null
    const changed = current ? store.gitWorkingTree().files : []
    return {
      branch, title: branch === 'feat/search' ? '검색 개선' : branch === 'feat/theme' ? '테마 조정' : branch,
      notes: sample ? '데모 작업입니다. 실제 에이전트나 개발 서버는 실행하지 않습니다.' : '', validation: '', review: 'pending', revision: 'a'.repeat(64),
      previewPort: branch === 'feat/search' ? 5101 : null, previewPath: '/', previewStatus: branch === 'feat/search' ? 'stopped' : 'unconfigured',
      current, isBase: branch === 'main', worktreePath, worktreePaths: worktreePath ? [worktreePath] : [],
      dirty: worktreePath ? { staged: 0, unstaged: changed.filter(file => file.status !== '?').length, untracked: changed.filter(file => file.status === '?').length } : null,
      commit: commit ? { hash: commit.hash, subject: commit.subject, committedAt: commit.date } : null, updatedAt: null,
      ...metadata[branch],
    }
  })
  return { workspace, isGitRepository: true, baseBranch: 'main', currentBranch, branches, canEdit: true, canPreview: false }
}

function editDemoBranchFeature(store: DemoWorkspaceStore, workspace: string, body: Record<string, unknown>): BranchFeatureSnapshot {
  const before = readDemoBranchFeatures(store, workspace)
  if (typeof body.branch !== 'string' || !before.branches.some(branch => branch.branch === body.branch)) throw new DemoError('브랜치를 찾을 수 없습니다.', 404)
  if (body.expectedRevision !== undefined && body.expectedRevision !== before.branches.find(branch => branch.branch === body.branch)!.revision) throw new DemoError('작업이 변경되었습니다. 다시 확인해 주세요.', 409)
  const patch: Partial<BranchFeature> = {}
  for (const [key, maximum] of [['title', 200], ['notes', 10_000], ['validation', 10_000]] as const) {
    if (!(key in body)) continue
    if (typeof body[key] !== 'string' || body[key].length > maximum || body[key].includes('\0')) throw new DemoError(`${key} 값을 확인해 주세요.`)
    patch[key] = body[key].trim()
  }
  if ('review' in body) {
    if (!['pending', 'verified', 'needs-fix'].includes(String(body.review))) throw new DemoError('확인 상태를 선택하세요.')
    patch.review = body.review as BranchFeaturePatch['review']
  }
  if ('previewPort' in body) {
    if (body.previewPort !== null && !validPreviewPort(body.previewPort)) throw new DemoError('미리보기 포트를 확인해 주세요.')
    patch.previewPort = body.previewPort
    patch.previewStatus = body.previewPort === null ? 'unconfigured' : 'stopped'
  }
  if ('previewPath' in body) {
    const value = body.previewPath
    if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new DemoError('미리보기 경로를 확인해 주세요.')
    const pathname = value.split(/[?#]/, 1)[0]
    try { if (/%(?:00|0a|0d|2f|5c)/i.test(pathname) || pathname.split('/').some(part => ['.', '..'].includes(decodeURIComponent(part)))) throw new Error('unsafe path') }
    catch { throw new DemoError('미리보기 경로를 확인해 주세요.') }
    patch.previewPath = value
  }
  const metadata = store.getState<Record<string, Partial<BranchFeature>>>(branchesKey(workspace), {})
  store.setState(branchesKey(workspace), { ...metadata, [body.branch]: { ...metadata[body.branch], ...patch, updatedAt: new Date().toISOString() } })
  return readDemoBranchFeatures(store, workspace)
}

function featureDocuments(store: DemoWorkspaceStore, workspace: string) {
  const files = demoWorkspaceFiles(store, workspace).filter(file => file.path.startsWith('docs/features/') && /\.md$/i.test(file.path) && basename(file.path) !== 'README.md')
  const representatives = new Map<string, string>()
  for (const file of files) {
    const directory = parent(file.path), name = basename(file.path)
    if (directory !== 'docs/features' && (name === representativeName(directory) || !representatives.has(directory) && ['MOC.md', '_MOC.md'].includes(name))) representatives.set(directory, file.path)
  }
  const documents = files.filter(file => !['MOC.md', '_MOC.md'].includes(basename(file.path)) || representatives.get(parent(file.path)) === file.path).map(file => {
    const document = demoDocument(file.content), fields = document.fields
    const content = document.body.trim(), stamp = '2026-10-01T09:00:00.000Z'
    const feature: Feature = {
      id: typeof fields.id === 'string' ? fields.id : `demo-feature-${demoDocumentHash(file.path).toString(16)}`, parentId: null, title: featureName(file.path), content,
      status: ['implemented', 'verified', 'needs-fix', 'changed'].includes(String(fields.status)) ? fields.status as Feature['status'] : 'changed', version: demoDocumentHash(file.path + file.content),
      createdAt: typeof fields.created === 'string' ? fields.created : stamp, updatedAt: typeof fields.updated === 'string' ? fields.updated : stamp, documentPath: file.path, report: null,
    }
    return { ...document, feature, raw: file.content }
  })
  const byPath = new Map(documents.map(document => [document.feature.documentPath!, document]))
  for (const document of documents) {
    let directory = parent(document.feature.documentPath!)
    while (directory.startsWith('docs/features/')) {
      const ancestor = byPath.get(representatives.get(directory) ?? `${directory}.md`)
      if (ancestor && ancestor !== document) { document.feature.parentId = ancestor.feature.id; break }
      directory = parent(directory)
    }
  }
  return documents
}

export function readDemoFeatureSnapshot(store: DemoWorkspaceStore, workspace = store.workspaceInfo().path): FeatureWorkspace & { canEdit: true } {
  return { version: 1, workspace, revision: store.revision, features: featureDocuments(store, workspace).map(document => document.feature), runs: store.getState<FeatureRun[]>(runsKey(workspace), []), canEdit: true }
}

export function loadDemoFeatureDocuments(store: DemoWorkspaceStore, workspace = store.workspaceInfo().path, signal?: AbortSignal): Promise<void> {
  return loadDemoWorkspaceDocuments(store, workspace, path => path.startsWith('docs/features/') && /\.md$/i.test(path) && basename(path) !== 'README.md', signal)
}

async function renameFeature(store: DemoWorkspaceStore, workspace: string, feature: Feature, title: string): Promise<string> {
  const source = feature.documentPath!, directory = parent(source), representative = basename(source) === representativeName(directory) || ['MOC.md', '_MOC.md'].includes(basename(source))
  const target = representative ? `${parent(directory)}/${title}/${representativeName(title)}` : `${directory}/${title}.md`
  if (target === source) return source
  await loadDemoWorkspaceDocuments(store, workspace, path => /\.md$/i.test(path))
  requireDemoWorkspace(store, workspace)
  const files = demoWorkspaceFiles(store, workspace), sourceDirectory = representative ? directory : null
  const moves: DocumentPageMove[] = [{ from: source, to: target }, ...(sourceDirectory ? [{ from: sourceDirectory, to: parent(target), directory: true }] : [])]
  const affected = files.filter(file => /\.md$/i.test(file.path)).map(file => ({ source: file.path, target: remapPagePath(file.path, moves), content: rewritePageLinks(file.content, file.path, remapPagePath(file.path, moves), moves) }))
  const moving = new Set(affected.filter(file => file.source !== file.target).map(file => file.source)), occupied = new Set(store.fileMetadata().filter(file => !moving.has(file.path)).map(file => file.path.normalize('NFC').toLowerCase()))
  for (const file of affected) if (file.source !== file.target && occupied.has(file.target.normalize('NFC').toLowerCase())) throw new DemoError('같은 이름의 기능 문서가 이미 있습니다.', 409)
  // Move the folder first so non-Markdown children and the explorer hierarchy stay together.
  if (representative) {
    store.movePath(`${workspace}/${directory}`, `${workspace}/${parent(target)}`)
    const movedSource = `${parent(target)}/${basename(source)}`
    if (movedSource !== target) store.movePath(`${workspace}/${movedSource}`, `${workspace}/${target}`)
  } else store.movePath(`${workspace}/${source}`, `${workspace}/${target}`)
  for (const file of affected) if (file.source !== file.target || files.find(candidate => candidate.path === file.source)?.content !== file.content) store.writeFile(`${workspace}/${file.target}`, file.content)
  return target
}

async function edit(store: DemoWorkspaceStore, workspace: string, id: string, body: Record<string, unknown>): Promise<Feature> {
  const current = featureDocuments(store, workspace).find(document => document.feature.id === id)
  if (!current) throw new DemoError('기능을 찾을 수 없습니다.', 404)
  if (body.version !== current.feature.version) throw new DemoError('기능 문서가 변경되었습니다. 최신 내용을 확인한 뒤 다시 저장하세요.', 409)
  const title = demoFilename(stringField(body, 'title', current.feature.title).replace(/\.md$/i, ''))
  if (!stringField(body, 'title', current.feature.title).trim() || title.startsWith('_') || ['MOC', 'README'].includes(title)) throw new DemoError('기능 제목을 확인해 주세요.')
  const nextParent = body.parentId === undefined ? current.feature.parentId : body.parentId
  if (nextParent !== current.feature.parentId) throw new DemoError('기능 이동은 Documents에서 폴더를 옮겨 체험할 수 있습니다.')
  const content = stringField(body, 'content', current.feature.content), path = await renameFeature(store, workspace, current.feature, title)
  requireDemoWorkspace(store, workspace)
  const document = demoDocument(store.readFile(`${workspace}/${path}`).content)
  document.yaml.set('id', id); document.yaml.set('title', title); document.yaml.set('updated', new Date().toISOString())
  if (document.yaml.get('description') === `기능: ${current.feature.title}`) document.yaml.set('description', `기능: ${title}`)
  if (title !== current.feature.title || content !== current.feature.content) document.yaml.set('status', 'changed')
  store.writeFile(`${workspace}/${path}`, `---\n${document.yaml.toString({ lineWidth: 0 })}---\n${content !== current.feature.content ? `\n${content}\n` : document.body}`)
  return readDemoFeatureSnapshot(store, workspace).features.find(feature => feature.id === id)!
}

export const handleDemoFeatures: DemoHttpHandler = async ({ store, request, url, body }) => {
  if (url.pathname !== '/api/features' && !url.pathname.startsWith('/api/features/')) return
  const workspace = requireDemoWorkspace(store, request.method === 'GET' ? url.searchParams.get('workspace') : body.workspace)
  if (url.pathname === '/api/features/branches') {
    requireMethod(request, 'GET', 'PATCH')
    return demoJson(request.method === 'GET' ? readDemoBranchFeatures(store, workspace) : editDemoBranchFeature(store, workspace, body))
  }
  await loadDemoFeatureDocuments(store, workspace, request.signal)
  requireDemoWorkspace(store, workspace)
  const segments = url.pathname.slice('/api/features'.length).split('/').filter(Boolean).map(decodeURIComponent)
  if (!segments.length) { requireMethod(request, 'GET'); return demoJson(readDemoFeatureSnapshot(store, workspace)) }
  if (segments[0] === 'requests') {
    requireMethod(request, 'POST')
    const id = stringField(body, 'id'), title = stringField(body, 'title').trim(), content = stringField(body, 'content')
    if (!/^[\w-]{1,100}$/.test(id) || !title) throw new DemoError('기능 제목과 요청을 확인해 주세요.')
    const runs = store.getState<FeatureRun[]>(runsKey(workspace), []), existing = runs.find(run => run.id === id)
    if (existing) return demoJson({ run: existing }, 202)
    let feature: Feature
    if (typeof body.targetId === 'string') {
      const target = readDemoFeatureSnapshot(store, workspace).features.find(item => item.id === body.targetId)
      if (!target) throw new DemoError('기능을 찾을 수 없습니다.', 404)
      feature = await edit(store, workspace, target.id, { version: body.expectedVersion ?? target.version, title, content })
    } else {
      const filename = demoFilename(title)
      if (filename.startsWith('_') || ['MOC', 'README'].includes(filename)) throw new DemoError('기능 제목을 확인해 주세요.')
      const path = `docs/features/${filename}.md`
      if (demoWorkspaceFiles(store, workspace).some(file => file.path === path)) throw new DemoError('같은 이름의 기능 문서가 이미 있습니다.', 409)
      store.writeFile(`${workspace}/${path}`, `---\nid: ${id}\ntitle: ${JSON.stringify(filename)}\ndescription: ${JSON.stringify(`기능: ${filename}`)}\nstatus: implemented\ncreated: ${JSON.stringify(new Date().toISOString())}\n---\n\n${content}\n`)
      feature = readDemoFeatureSnapshot(store, workspace).features.find(item => item.id === id)!
    }
    const stamp = new Date().toISOString(), report: FeatureReport = { summary: '예제 기능 문서를 준비했습니다.', validation: '브라우저 메모리의 데모 데이터에 반영했습니다.', files: [feature.documentPath!], commits: [] }
    const run: FeatureRun = { id, owner: DEMO_USER.email, title, content, targetId: typeof body.targetId === 'string' ? body.targetId : null, targetVersion: null, parentId: feature.parentId, featureId: feature.id, featureVersion: feature.version,
      agentSet: { id: stringField(body, 'agentSetId', 'demo-default'), name: 'Demo agent', runtime: 'codex', modelId: 'demo-model', role: '' }, context: { projectRoot: workspace, docsRoot: `${workspace}/docs` }, tabId: `demo-feature-${id}`, sessionId: null, dispatchedAt: stamp, state: 'completed', reason: '', error: '', createdAt: stamp, updatedAt: stamp, report }
    store.setState(runsKey(workspace), [...runs, run]); return demoJson({ run }, 202)
  }
  if (segments[0] === 'runs' && segments[2] === 'cancel') {
    requireMethod(request, 'POST')
    const runs = store.getState<FeatureRun[]>(runsKey(workspace), []), run = runs.find(item => item.id === segments[1])
    if (!run) throw new DemoError('기능 실행을 찾을 수 없습니다.', 404)
    if (run.state !== 'completed') run.state = 'cancelled'
    store.setState(runsKey(workspace), runs); return demoJson({ ok: true })
  }
  if (segments[1] === 'status') {
    requireMethod(request, 'POST')
    const document = featureDocuments(store, workspace).find(item => item.feature.id === segments[0])
    if (!document) throw new DemoError('기능을 찾을 수 없습니다.', 404)
    if (body.version !== document.feature.version) throw new DemoError('기능 문서가 변경되었습니다. 다시 확인해 주세요.', 409)
    if (!['verified', 'needs-fix'].includes(String(body.status))) throw new DemoError('기능 상태를 확인해 주세요.')
    document.yaml.set('status', body.status)
    store.writeFile(`${workspace}/${document.feature.documentPath}`, `---\n${document.yaml.toString({ lineWidth: 0 })}---\n${document.body}`)
    return demoJson({ feature: readDemoFeatureSnapshot(store, workspace).features.find(item => item.id === segments[0]) })
  }
  requireMethod(request, 'PATCH')
  return demoJson({ feature: await edit(store, workspace, segments[0], body) })
}
