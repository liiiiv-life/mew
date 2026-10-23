import type { TaskChange, TaskItem } from '../../shared/task-list.ts'
import { applyTaskChanges, TaskConflict, TASK_LIMIT, TASK_TEXT_LIMIT, validTaskDates, validTaskTree } from '../../shared/task-list.ts'
import { validAssignees } from '../../shared/task-assignees.ts'
import { collectTaskTags, removeTaskTags, validDeletedTags, validTags } from '../../shared/task-tags.ts'
import { applyTagColorChanges, removeTagColors, validTagColorChanges, type TaskTagColors } from '../../shared/task-tag-colors.ts'
import { demoDocument, demoDocumentHash, demoFilename, demoWorkspaceFiles, loadDemoWorkspaceDocuments, requireDemoWorkspace } from './document-utils.ts'
import { demoJson, requireMethod, type DemoHttpHandler } from './http.ts'
import { DemoError, type DemoWorkspaceStore } from './workspace-store.ts'
import { parseDocument } from 'yaml'

type Identity = { id: string; path: string }
const guides = new Set(['_tasks.md', 'readme.md', 'moc.md', '_moc.md'])
const validItem = (item: unknown): item is TaskItem => {
  if (!item || typeof item !== 'object') return false
  const value = item as TaskItem
  return typeof value.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.id) && typeof value.text === 'string' && value.text.length <= TASK_TEXT_LIMIT && typeof value.done === 'boolean'
    && value.parentId == null && (value.tags === undefined || validTags(value.tags)) && (value.assignees === undefined || validAssignees(value.assignees)) && validTaskDates(value)
}
const stateKey = (workspace: string, field: string) => `tasks:${workspace}:${field}`
const taskDocumentList = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (!text) return undefined
  if (!text.startsWith('[')) return [text]
  const parsed = parseDocument(text)
  return parsed.errors.length ? value : parsed.toJS({ maxAliasCount: 20 })
}

function taskDocuments(store: DemoWorkspaceStore, workspace: string) {
  const identities = store.getState<Identity[]>(stateKey(workspace, 'identities'), [])
  return demoWorkspaceFiles(store, workspace).filter(file => file.path.startsWith('docs/tasks/') && !file.path.slice('docs/tasks/'.length).includes('/') && /\.md$/i.test(file.path) && !guides.has(file.path.split('/').at(-1)!.toLowerCase())).map(file => {
    const document = demoDocument(file.content), fields = document.fields
    const id = identities.find(item => item.path === file.path)?.id ?? `demo-task-${demoDocumentHash(file.path).toString(16)}`
    const tags = taskDocumentList(fields.tags), assignees = taskDocumentList(fields.assignees), done = fields.done === 'true' ? true : fields.done === 'false' ? false : fields.done
    const task = { id, path: file.path, text: fields.title ?? file.path.split('/').at(-1)!.slice(0, -3), done: done ?? false,
      ...(tags != null ? { tags } : {}), ...(assignees != null ? { assignees } : {}),
      ...(fields.date != null ? { date: fields.date } : {}), ...(fields.startDate != null ? { startDate: fields.startDate } : {}),
    } as TaskItem
    if (!validItem(task)) throw new DemoError(`태스크 문서의 속성을 확인해 주세요: ${file.path}`)
    return { ...document, raw: file.content, task }
  })
}

export function readDemoTaskSnapshot(store: DemoWorkspaceStore, workspace = store.workspaceInfo().path) {
  const order = store.getState<string[]>(stateKey(workspace, 'order'), []), rank = new Map(order.map((id, index) => [id, index]))
  const tasks = taskDocuments(store, workspace).map(document => document.task).sort((a, b) => (rank.get(a.id) ?? order.length) - (rank.get(b.id) ?? order.length))
  return { tasks, canEdit: true, tags: collectTaskTags(tasks, store.getState<string[]>(stateKey(workspace, 'tags'), [])), tagColors: store.getState<TaskTagColors>(stateKey(workspace, 'colors'), {}) }
}

export function loadDemoTaskDocuments(store: DemoWorkspaceStore, workspace = store.workspaceInfo().path, signal?: AbortSignal): Promise<void> {
  return loadDemoWorkspaceDocuments(store, workspace, path => path.startsWith('docs/tasks/') && !path.slice('docs/tasks/'.length).includes('/') && /\.md$/i.test(path) && !guides.has(path.split('/').at(-1)!.toLowerCase()), signal)
}

function saveTasks(store: DemoWorkspaceStore, workspace: string, tasks: TaskItem[]) {
  const documents = taskDocuments(store, workspace), previous = new Map(documents.map(document => [document.task.id, document])), occupied = new Set(guides)
  const paths = new Map<string, string>(), key = (path: string) => path.normalize('NFC').toLowerCase()
  for (const task of tasks) {
    const stem = `docs/tasks/${demoFilename(task.text)}`, old = previous.get(task.id)?.task.path
    if (old && (old === `${stem}.md` || old.startsWith(`${stem} (`)) && !occupied.has(key(old))) { paths.set(task.id, old); occupied.add(key(old)) }
  }
  const writes: { path: string; content: string }[] = []
  for (const task of tasks) {
    let path = paths.get(task.id)
    if (!path) {
      const stem = `docs/tasks/${demoFilename(task.text)}`
      path = `${stem}.md`; let index = 2
      while (occupied.has(key(path)) || guides.has(path.split('/').at(-1)!.toLowerCase())) path = `${stem} (${index++}).md`
      occupied.add(key(path)); paths.set(task.id, path)
    }
    const old = previous.get(task.id), yaml = old?.yaml ?? demoDocument('').yaml
    yaml.set('title', task.text); yaml.set('done', task.done)
    if (!old || yaml.get('description') === `태스크: ${old.task.text.trim() || '제목 없음'}`) yaml.set('description', `태스크: ${task.text.trim() || '제목 없음'}`)
    for (const field of ['tags', 'assignees', 'startDate', 'date'] as const) {
      const value = task[field]
      if (value == null || Array.isArray(value) && !value.length) yaml.delete(field)
      else yaml.set(field, value)
    }
    writes.push({ path, content: `---\n${yaml.toString({ lineWidth: 0 })}---\n${old?.body ?? ''}` })
  }
  const retained = new Set(writes.map(write => write.path))
  for (const document of documents) if (!retained.has(document.task.path!)) store.deletePath(`${workspace}/${document.task.path}`)
  for (const write of writes) store.writeFile(`${workspace}/${write.path}`, write.content)
  store.setState(stateKey(workspace, 'identities'), tasks.map(task => ({ id: task.id, path: paths.get(task.id)! })))
  store.setState(stateKey(workspace, 'order'), tasks.map(task => task.id))
}

export const handleDemoTasks: DemoHttpHandler = async ({ store, request, url, body }) => {
  if (url.pathname === '/api/task-list/events') {
    requireMethod(request, 'GET')
    const workspace = requireDemoWorkspace(store, url.searchParams.get('workspace'))
    let unsubscribe = () => {}, cleanup = () => {}, closed = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let pending = false
        const encoder = new TextEncoder()
        cleanup = () => { if (closed) return; closed = true; unsubscribe(); request.signal.removeEventListener('abort', cleanup); controller.close() }
        controller.enqueue(encoder.encode(': demo task events\n\n'))
        const root = store.canonicalFilePath(workspace), prefix = `${root ? `${root}/` : ''}docs/tasks/`
        unsubscribe = store.subscribe(event => {
          if (event.type === 'close' || event.type === 'state' && event.key === 'workspace' && store.workspaceInfo().path !== workspace) { cleanup(); return }
          if (event.type !== 'reset' && !(event.type === 'files' && (!event.path || event.path.startsWith(prefix))) && !(event.type === 'state' && event.key?.startsWith(`tasks:${workspace}:`))) return
          if (pending) return
          pending = true
          queueMicrotask(() => { pending = false; if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ revision: store.revision })}\n\n`)) })
        })
        request.signal.addEventListener('abort', cleanup, { once: true })
      },
      cancel() { closed = true; unsubscribe(); request.signal.removeEventListener('abort', cleanup) },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  }
  if (url.pathname !== '/api/task-list') return
  requireMethod(request, 'GET', 'PATCH')
  const workspace = requireDemoWorkspace(store, request.method === 'GET' ? url.searchParams.get('workspace') : body.workspace)
  await loadDemoTaskDocuments(store, workspace, request.signal)
  requireDemoWorkspace(store, workspace)
  if (request.method === 'GET') return demoJson(readDemoTaskSnapshot(store, workspace))
  const changes = body.changes, colorChanges = body.tagColorChanges ?? [], deleted = body.deletedTags ?? []
  if (!Array.isArray(changes) || changes.length > TASK_LIMIT * 2 || !validTagColorChanges(colorChanges) || !validDeletedTags(deleted)) throw new DemoError('태스크 변경 내용을 확인해 주세요.')
  const ids = new Set<string>()
  for (const change of changes as TaskChange[]) {
    if (!change || typeof change !== 'object' || typeof change.id !== 'string' || ids.has(change.id) || change.before === null && change.after === null
      || change.before !== null && (!validItem(change.before) || change.before.id !== change.id) || change.after !== null && (!validItem(change.after) || change.after.id !== change.id)
      || change.afterId !== null && (typeof change.afterId !== 'string' || change.afterId === change.id) || change.move !== undefined && typeof change.move !== 'boolean') throw new DemoError('태스크 변경 내용을 확인해 주세요.')
    ids.add(change.id)
  }
  try {
    const before = readDemoTaskSnapshot(store, workspace)
    const clean = (item: TaskItem | null) => item && removeTaskTags([item], deleted)[0]
    const tasks = removeTaskTags(applyTaskChanges(removeTaskTags(before.tasks, deleted), (changes as TaskChange[]).map(change => ({ ...change, before: clean(change.before), after: clean(change.after) }))), deleted)
    const colors = removeTagColors(applyTagColorChanges(before.tagColors, colorChanges), deleted)
    if (tasks.length > TASK_LIMIT || !validTaskTree(tasks)) throw new DemoError('태스크는 최대 2,000개까지 추가할 수 있습니다.')
    saveTasks(store, workspace, tasks)
    store.setState(stateKey(workspace, 'tags'), collectTaskTags(tasks, before.tags).filter(tag => !deleted.includes(tag)))
    store.setState(stateKey(workspace, 'colors'), colors)
    return demoJson(readDemoTaskSnapshot(store, workspace))
  } catch (error) { if (error instanceof TaskConflict) throw new DemoError(error.message, 409); throw error }
}
