import { applyTaskChanges, taskChanges, taskParent, taskDate, taskStartDate, validTaskTree, type TaskBoard, type TaskChange, type TaskItem } from '../../shared/task-list.ts'
import { taskRollups, taskWithRollup } from '../../shared/task-rollup.ts'
import { sameTags, taskTags, validTags } from '../../shared/task-tags.ts'
import { writeBrowserStorage } from '@mew/ui/browser-storage'

type TaskApi = { read: () => Promise<TaskBoard>; save: (changes: TaskChange[]) => Promise<TaskBoard> }
type State = TaskBoard & { loading: boolean; saving: boolean; error: string | null; draft: string; draftTags: string[] }

/** Lives above the project-keyed dock so closing/remounting a panel cannot discard pending edits. */
export class TaskListSession {
  state: State = { tasks: [], canEdit: false, loading: true, saving: false, error: null, draft: '', draftTags: [] }
  private baseline: TaskItem[] = []
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private reading = false
  private disposed = false
  private api: TaskApi
  private draftKey?: string
  constructor(api: TaskApi, draftKey?: string) {
    this.api = api
    this.draftKey = draftKey
    try {
      const draft = draftKey ? JSON.parse(localStorage.getItem(draftKey) ?? 'null') : null
      const validItems = (items: unknown): items is TaskItem[] => Array.isArray(items) && items.length <= 2000 && items.every(item => item && typeof item.id === 'string' && typeof item.text === 'string' && typeof item.done === 'boolean' && (item.parentId == null || typeof item.parentId === 'string')) && validTaskTree(items)
      if (validItems(draft?.baseline) && validItems(draft?.tasks)) {
        const flatten = (items: TaskItem[]) => { const rollups = taskRollups(items); return items.map(item => { const { parentId: _parentId, ...task } = taskWithRollup(item, rollups); return task }) }
        this.baseline = flatten(draft.baseline)
        this.state = { ...this.state, tasks: flatten(draft.tasks), draft: typeof draft.draft === 'string' ? draft.draft : '', draftTags: validTags(draft.draftTags) ? draft.draftTags : [] }
      }
    } catch { /* Invalid or unavailable browser storage. */ }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.state
  private publish(patch: Partial<State>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    if (this.draftKey) try {
      if (this.state.draft || this.state.draftTags.length || taskChanges(this.baseline, this.state.tasks).length) writeBrowserStorage(this.draftKey, JSON.stringify({ baseline: this.baseline, tasks: this.state.tasks, draft: this.state.draft, draftTags: this.state.draftTags }))
      else localStorage.removeItem(this.draftKey)
    } catch { /* In-memory drafts remain available when storage is full. */ }
    for (const listener of this.listeners) listener()
  }
  private schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush() }, 350) }
  edit(tasks: TaskItem[]) {
    if (!this.state.canEdit || this.disposed) return
    this.publish({ tasks })
    if (!this.state.error) this.schedule()
  }
  setDraft(draft: string) { if (this.state.canEdit) this.publish({ draft }) }
  setDraftTags(draftTags: string[]) { if (this.state.canEdit) this.publish({ draftTags }) }
  async refresh() {
    if (this.disposed || this.reading || this.state.saving || this.state.error || (!this.state.loading && taskChanges(this.baseline, this.state.tasks).length)) return
    this.reading = true
    // Edits made while a polling request is in flight must also survive its response.
    const before = this.baseline
    try {
      const board = await this.api.read()
      if (this.disposed) return
      const pending = taskChanges(before, this.state.tasks)
      const tasks = applyTaskChanges(board.tasks, pending)
      this.baseline = board.tasks
      this.publish({ ...board, tasks, loading: false, error: null })
      if (pending.length && board.canEdit) this.schedule()
    } catch (error) { this.publish({ loading: false, error: (error as Error).message }) }
    finally { this.reading = false }
  }
  async flush() {
    clearTimeout(this.timer)
    if (this.disposed || this.reading || this.state.loading || this.state.saving || this.state.error || !this.state.canEdit) return
    const sent = this.state.tasks
    const changes = taskChanges(this.baseline, sent)
    if (!changes.length) return
    this.publish({ saving: true })
    try {
      const board = await this.api.save(changes)
      if (this.disposed) return
      const pending = taskChanges(sent, this.state.tasks)
      const tasks = applyTaskChanges(board.tasks, pending)
      this.baseline = board.tasks
      this.publish({ ...board, tasks, saving: false })
      if (pending.length) this.schedule()
    } catch (error) { this.publish({ saving: false, error: (error as Error).message }) }
  }
  async retry() {
    if (this.disposed || this.reading || this.state.saving) return
    this.reading = true
    try {
      const board = await this.api.read()
      if (this.disposed) return
      const pending = taskChanges(this.baseline, this.state.tasks)
      // Explicit retry keeps local changed fields and preserves unrelated remote fields.
      const rebased = pending.map(change => {
        const current = board.tasks.find(item => item.id === change.id) ?? null
        if (!change.after || !change.before || !current) return { ...change, before: current }
        return { ...change, before: current, after: { ...current,
          text: change.after.text !== change.before.text ? change.after.text : current.text,
          tags: !sameTags(change.after.tags, change.before.tags) ? taskTags(change.after) : taskTags(current),
          done: change.after.done !== change.before.done ? change.after.done : current.done,
          date: taskDate(change.after) !== taskDate(change.before) ? taskDate(change.after) : taskDate(current),
          startDate: taskStartDate(change.after) !== taskStartDate(change.before) ? taskStartDate(change.after) : taskStartDate(current),
          parentId: taskParent(change.after) !== taskParent(change.before) ? taskParent(change.after) : taskParent(current) } }
      }).filter(change => change.before || change.after)
      const tasks = applyTaskChanges(board.tasks, rebased)
      this.baseline = board.tasks
      this.publish({ ...board, tasks, error: null, loading: false })
    } catch (error) { this.publish({ error: (error as Error).message }) }
    finally { this.reading = false }
    await this.flush()
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear() }
}
