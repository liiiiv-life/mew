import { removeTaskTags } from '../../shared/task-tags.ts'
import { applyTagColorChanges, type TaskTagColorChange } from '../../shared/task-tag-colors.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { TaskListSession } from './task-list-session.ts'
import { applyTaskChanges, TaskConflict, type TaskBoard } from '../../shared/task-list.ts'

const item = { id: 'one', text: 'first', done: false }
test('a second reorder during an in-flight save preserves order and remote completion', async () => {
  const second = { id: 'two', text: 'second', done: false }
  let resolveSave!: (board: TaskBoard) => void
  const session = new TaskListSession({ read: async () => ({ tasks: [item, second], canEdit: true }), save: () => new Promise(resolve => { resolveSave = resolve }) })
  try {
    await session.refresh()
    session.edit([second, item])
    const saving = session.flush()
    session.edit([item, second])
    resolveSave({ tasks: [second, { ...item, done: true }], canEdit: true })
    await saving
    assert.deepEqual(session.state.tasks, [{ ...item, done: true }, second])
  } finally { session.dispose() }
})
test('editing during save rebases pending local text over remotely changed completion', async () => {
  let resolveSave!: (board: TaskBoard) => void
  const session = new TaskListSession({ read: async () => ({ tasks: [item], canEdit: true }), save: () => new Promise(resolve => { resolveSave = resolve }) })
  try {
    await session.refresh()
    session.edit([{ ...item, text: 'second' }])
    const saving = session.flush()
    session.edit([{ ...item, text: 'third' }])
    resolveSave({ tasks: [{ ...item, text: 'second', done: true }], canEdit: true })
    await saving
    assert.deepEqual(session.state.tasks, [{ ...item, text: 'third', done: true }])
  } finally { session.dispose() }
})
test('failed writes keep input and explicit retry preserves unrelated remote fields', async () => {
  let fail = true, serverItems = [item]
  const session = new TaskListSession({ read: async () => ({ tasks: serverItems, canEdit: true }), save: async changes => {
    if (fail) throw new Error('태스크를 저장하지 못했습니다')
    serverItems = applyTaskChanges(serverItems, changes)
    return { tasks: serverItems, canEdit: true }
  } })
  try {
    await session.refresh()
    session.edit([{ ...item, text: 'local' }]); await session.flush()
    await session.flush(); await session.flush()
    assert.equal(session.state.tasks[0].text, 'local'); assert.ok(session.state.error)
    serverItems = [{ ...item, text: 'remote', done: true }]
    fail = false; await session.retry()
    assert.equal(session.state.error, null)
    assert.deepEqual(serverItems, [{ ...item, text: 'local', done: true }])
  } finally { session.dispose() }
})
test('polling response cannot discard text entered while the read was in flight', async () => {
  let resolveRead!: (board: TaskBoard) => void, delayed = false
  const session = new TaskListSession({ read: () => delayed ? new Promise(resolve => { resolveRead = resolve }) : Promise.resolve({ tasks: [item], canEdit: true }), save: async () => ({ tasks: [], canEdit: true }) })
  try {
    await session.refresh(); delayed = true
    const reading = session.refresh()
    session.edit([{ ...item, text: 'local' }])
    resolveRead({ tasks: [{ ...item, done: true }], canEdit: true })
    await reading
    assert.deepEqual(session.state.tasks, [{ ...item, text: 'local', done: true }])
  } finally { session.dispose() }
})

test('a failed date write retries over remote text and completion without losing the date', async () => {
  let fail = true
  let serverItems: import('../../shared/task-list.ts').TaskItem[] = [item]
  const session = new TaskListSession({ read: async () => ({ tasks: serverItems, canEdit: true }), save: async changes => {
    if (fail) throw new Error('태스크를 저장하지 못했습니다')
    serverItems = applyTaskChanges(serverItems, changes)
    return { tasks: serverItems, canEdit: true }
  } })
  try {
    await session.refresh()
    session.edit([{ ...item, startDate: '2026-10-13', date: '2026-10-15' }]); await session.flush()
    assert.equal(session.state.tasks[0].date, '2026-10-15')
    assert.equal(session.state.tasks[0].startDate, '2026-10-13')
    serverItems = [{ ...item, text: 'remote', done: true, startDate: '2026-10-14', date: '2026-10-16' }]
    fail = false; await session.retry()
    assert.equal(session.state.error, null)
    assert.equal(serverItems[0].date, '2026-10-15')
    assert.equal(serverItems[0].startDate, '2026-10-13')
    assert.equal(serverItems[0].text, 'remote'); assert.equal(serverItems[0].done, true)
  } finally { session.dispose() }
})

test('failed tag writes retry without overwriting remote content or completion', async () => {
  let serverItems = [{ ...item, tags: ['abc'] }], fail = true
  const session = new TaskListSession({ read: async () => ({ tasks: serverItems, canEdit: true, tags: ['abc'] }), save: async changes => {
    if (fail) throw new Error('save failed')
    serverItems = applyTaskChanges(serverItems, changes) as typeof serverItems
    return { tasks: serverItems, canEdit: true, tags: ['abc', 'abcde'] }
  } })
  try {
    await session.refresh()
    session.setDraft('draft'); session.setDraftTags(['abc'])
    session.edit([{ ...serverItems[0], tags: ['abc', 'abcde'] }]); await session.flush()
    await session.flush(); await session.flush()
    assert.ok(session.state.error)
    serverItems = [{ ...serverItems[0], text: 'remote', done: true }]; fail = false
    await session.retry()
    assert.deepEqual(serverItems, [{ ...item, text: 'remote', done: true, tags: ['abc', 'abcde'] }])
    assert.deepEqual(session.state.draftTags, ['abc'])
    assert.deepEqual(session.state.tags, ['abc', 'abcde'])
  } finally { session.dispose() }
})


test('temporary failures retry automatically without showing an alert and preserve later input', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let attempts = 0, serverItems = [item]
  const session = new TaskListSession({ read: async () => ({ tasks: serverItems, canEdit: true }), save: async changes => {
    attempts++
    if (attempts === 1) throw Object.assign(new Error('temporary'), { status: 500 })
    serverItems = applyTaskChanges(serverItems, changes)
    return { tasks: serverItems, canEdit: true }
  } })
  try {
    await session.refresh()
    session.edit([{ ...item, text: 'local' }]); await session.flush()
    assert.equal(session.state.error, null)
    session.edit([{ ...item, text: 'later' }])
    t.mock.timers.tick(999)
    assert.equal(attempts, 1)
    t.mock.timers.tick(1)
    await Promise.resolve(); await Promise.resolve()
    assert.equal(attempts, 2)
    assert.equal(session.state.error, null)
    assert.equal(session.state.tasks[0].text, 'later')
    await session.flush()
    assert.equal(serverItems[0].text, 'later')
  } finally { session.dispose() }
})

test('retry resends an acknowledged creation before saving edits made after a lost response', async () => {
  let attempts = 0, serverItems: typeof item[] = []
  const session = new TaskListSession({ read: async () => ({ tasks: serverItems, canEdit: true }), save: async changes => {
    attempts++
    serverItems = applyTaskChanges(serverItems, changes)
    if (attempts === 1) throw new TypeError('Failed to fetch')
    return { tasks: serverItems, canEdit: true }
  } })
  try {
    await session.refresh()
    session.edit([item]); await session.flush()
    session.edit([{ ...item, text: 'later' }])
    await session.flush(); await session.flush()
    assert.deepEqual(serverItems, [{ ...item, text: 'later' }])
    assert.equal(session.state.error, null)
  } finally { session.dispose() }
})

test('repeated failures stop after two automatic retries and keep the draft', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let attempts = 0
  const session = new TaskListSession({ read: async () => ({ tasks: [item], canEdit: true }), save: async () => {
    attempts++; throw Object.assign(new Error('unavailable'), { status: 503 })
  } })
  try {
    await session.refresh()
    session.edit([{ ...item, text: 'local' }]); await session.flush()
    for (const delay of [1000, 3000]) { t.mock.timers.tick(delay); await Promise.resolve(); await Promise.resolve() }
    assert.equal(attempts, 3)
    assert.equal(session.state.error, 'unavailable')
    assert.equal(session.state.tasks[0].text, 'local')
    t.mock.timers.tick(10000)
    assert.equal(attempts, 3)
  } finally { session.dispose() }
})

test('conflicts and rejected writes require explicit retry immediately', async () => {
  for (const error of [new TaskConflict(), ...[400, 401, 403, 409].map(status => Object.assign(new Error('rejected'), { status }))]) {
    const session = new TaskListSession({ read: async () => ({ tasks: [item], canEdit: true }), save: async () => { throw error } })
    try {
      await session.refresh()
      session.edit([{ ...item, text: 'local' }]); await session.flush()
      assert.equal(session.state.error, error.message)
      assert.equal(session.state.tasks[0].text, 'local')
    } finally { session.dispose() }
  }
})

test('disposing a session cancels its automatic save retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let attempts = 0
  const session = new TaskListSession({ read: async () => ({ tasks: [item], canEdit: true }), save: async () => { attempts++; throw new TypeError('Failed to fetch') } })
  await session.refresh()
  session.edit([{ ...item, text: 'local' }]); await session.flush()
  session.dispose(); t.mock.timers.tick(10000)
  assert.equal(attempts, 1)
})

test('tag colors preserve edits during saves and merge unrelated remote tags', async () => {
  let resolveSave!: (board: TaskBoard) => void
  let sentColors: TaskTagColorChange[] = []
  const session = new TaskListSession({ read: async () => ({ tasks: [item], tagColors: {}, canEdit: true }), save: (_changes, colors) => {
    sentColors = colors ?? []
    return new Promise(resolve => { resolveSave = resolve })
  } })
  try {
    await session.refresh()
    session.setTagColor('abc', 225)
    const saving = session.flush()
    session.setTagColor('abc', 325)
    resolveSave({ tasks: [item], tagColors: { abc: 225, other: 35 }, canEdit: true })
    await saving
    assert.deepEqual(sentColors, [{ tag: 'abc', before: null, after: 225 }])
    assert.deepEqual(session.state.tagColors, { abc: 325, other: 35 })
  } finally { session.dispose() }
})

test('color conflicts keep local choice and explicit retry preserves unrelated remote colors', async () => {
  let serverColors = { abc: 225, other: 35 }
  const session = new TaskListSession({ read: async () => ({ tasks: [item], tagColors: serverColors, canEdit: true }), save: async (_changes, colors) => {
    serverColors = applyTagColorChanges(serverColors, colors ?? []) as typeof serverColors
    return { tasks: [item], tagColors: serverColors, canEdit: true }
  } })
  try {
    await session.refresh()
    session.setTagColor('abc', 325)
    serverColors = { abc: 78, other: 155 }
    await session.flush()
    assert.ok(session.state.error)
    assert.equal(session.state.tagColors.abc, 325)
    await session.retry()
    assert.equal(session.state.error, null)
    assert.deepEqual(serverColors, { abc: 325, other: 155 })
    session.state = { ...session.state, canEdit: false }
    session.setTagColor('abc', 35)
    assert.equal(session.state.tagColors.abc, 325, 'read-only sessions cannot change colors')
  } finally { session.dispose() }
})

test('global tag deletion includes fresh remote tasks and keeps drafts, unrelated tags and colors', async () => {
  let stored = [{ ...item, tags: ['shared', 'keep'] }, { id: 'done', text: 'hidden', done: true, tags: ['shared'] }]
  let colors = { shared: 225, keep: 35 }
  let deletedBatch: string[] = []
  const session = new TaskListSession({ read: async () => ({ tasks: stored, tags: ['shared', 'keep'], tagColors: colors, canEdit: true }), save: async (changes, _colors, deleted = []) => {
    deletedBatch = deleted
    stored = removeTaskTags(applyTaskChanges(removeTaskTags(stored, deleted), changes), deleted) as typeof stored
    colors = Object.fromEntries(Object.entries(colors).filter(([tag]) => !deleted.includes(tag))) as typeof colors
    return { tasks: stored, tags: ['keep'], tagColors: colors, canEdit: true }
  } })
  try {
    await session.refresh()
    session.setDraftTags(['shared', 'keep'])
    session.edit([{ ...session.state.tasks[0], text: 'local edit', tags: ['shared', 'keep', 'extra'] }, session.state.tasks[1]])
    session.deleteTag('shared')
    stored = [...stored, { id: 'fresh', text: 'new remote task', done: false, tags: ['shared', 'remote'] }]
    await session.flush()
    assert.deepEqual(deletedBatch, ['shared'])
    assert.deepEqual(stored.map(task => task.tags), [['keep', 'extra'], [], ['remote']])
    assert.equal(stored[0].text, 'local edit')
    assert.deepEqual(session.state.draftTags, ['keep'])
    assert.deepEqual(session.state.tagColors, { keep: 35 })
    session.state = { ...session.state, canEdit: false }
    session.deleteTag('keep')
    assert.deepEqual(session.state.tagColors, { keep: 35 })
  } finally { session.dispose() }
})

test('deleting a tag during another save remains pending until a separate acknowledged deletion', async () => {
  let resolveSave!: (board: TaskBoard) => void
  const deletions: string[][] = []
  const session = new TaskListSession({ read: async () => ({ tasks: [{ ...item, tags: ['shared'] }], tags: ['shared'], tagColors: { shared: 225 }, canEdit: true }), save: (_changes, _colors, deleted = []) => {
    deletions.push(deleted)
    return new Promise(resolve => { resolveSave = resolve })
  } })
  try {
    await session.refresh()
    session.edit([{ ...session.state.tasks[0], text: 'edited' }])
    const saving = session.flush()
    session.deleteTag('shared')
    session.edit([{ ...session.state.tasks[0], tags: ['later'] }])
    resolveSave({ tasks: [{ ...item, text: 'edited', tags: ['shared'] }], tags: ['shared'], tagColors: { shared: 225 }, canEdit: true })
    await saving
    assert.deepEqual(session.state.tasks[0].tags, ['later'])
    assert.deepEqual(session.state.tagColors, {})
    const deleting = session.flush()
    assert.deepEqual(deletions, [[], ['shared']])
    resolveSave({ tasks: [{ ...item, text: 'edited', tags: ['later'] }], tags: ['later'], tagColors: {}, canEdit: true })
    await deleting
    assert.equal(session.state.error, null)
  } finally { session.dispose() }
})

test('a lost global deletion response retries the identical deletion without restoring the tag', async () => {
  let stored = [{ ...item, tags: ['shared', 'keep'] }], attempts = 0
  const deletedBatches: string[][] = []
  const session = new TaskListSession({ read: async () => ({ tasks: stored, tags: ['shared', 'keep'], canEdit: true }), save: async (_changes, _colors, deleted = []) => {
    attempts++; deletedBatches.push(deleted)
    stored = removeTaskTags(stored, deleted) as typeof stored
    if (attempts === 1) throw Object.assign(new Error('lost response'), { status: 503 })
    return { tasks: stored, tags: ['keep'], canEdit: true }
  } })
  try {
    await session.refresh()
    session.deleteTag('shared')
    await session.flush()
    assert.equal(session.state.error, null)
    await session.flush()
    assert.deepEqual(deletedBatches, [['shared'], ['shared']])
    assert.deepEqual(session.state.tasks[0].tags, ['keep'])
    assert.equal(session.state.error, null)
  } finally { session.dispose() }
})
