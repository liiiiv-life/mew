import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import type { Editor } from '@tiptap/core'
import { splitFrontmatter } from '@mew/editor/frontmatter'
import { SHARED_MEMO_PROJECT } from '../../shared/shared-memo.ts'
import type { CollaborationProvider, CollaborationSession } from '../runtime/app-runtime.ts'
import { identityColor } from '../utils/collabColor.ts'
import type { DemoWorkspaceStore } from './workspace-store.ts'

type Room = {
  ydoc: Y.Doc
  awareness: Awareness
  path: string
  content: string
  ready: boolean
  closed: boolean
  editor?: Editor
  listeners: Set<(session: CollaborationSession) => void>
}

function replaceText(text: Y.Text, value: string): void {
  const current = text.toString()
  let start = 0, end = 0
  while (start < current.length && start < value.length && current[start] === value[start]) start++
  while (end < current.length - start && end < value.length - start && current[current.length - end - 1] === value[value.length - end - 1]) end++
  const deleted = current.length - start - end, inserted = value.slice(start, value.length - end)
  if (deleted) text.delete(start, deleted)
  if (inserted) text.insert(start, inserted)
}

/** Local CRDT sessions use the production editor schema without a pretend Yjs server. */
export function createDemoCollaboration(store: DemoWorkspaceStore): CollaborationProvider {
  const rooms = new Map<string, Room>()
  let closed = false
  const state = (room: Room): CollaborationSession => ({ ydoc: room.ydoc, awareness: room.awareness, synced: room.ready, connected: room.ready && !room.closed })
  const notify = (room: Room) => { for (const listener of room.listeners) listener(state(room)) }

  function applyFile(room: Room): void {
    if (room.closed || !room.ready || room.path.startsWith(`${SHARED_MEMO_PROJECT}:`)) return
    let content: string
    try { content = store.readFile(`${store.workspacePath}/${room.path}`).content } catch { return }
    if (content === room.content) return
    room.content = content
    room.ydoc.transact(() => replaceText(room.ydoc.getText('content'), content), 'demo-store')
    if (room.editor) {
      const body = splitFrontmatter(content).body
      const storage = room.editor.storage as unknown as { markdown: { getMarkdown(): string } }
      if (body !== storage.markdown.getMarkdown()) room.editor.commands.setContent(body, { emitUpdate: false })
    }
  }

  async function prepare(room: Room): Promise<void> {
    const isMemo = room.path.startsWith(`${SHARED_MEMO_PROJECT}:`)
    if (!isMemo && !store.isFileLoaded(`${store.workspacePath}/${room.path}`)) await store.loadFile(`${store.workspacePath}/${room.path}`)
    if (room.path.endsWith('.md')) {
      const [{ Editor: TiptapEditor }, { Collaboration }, { serverEditorExtensions }] = await Promise.all([
        import('@tiptap/core'), import('@tiptap/extension-collaboration'), import('@mew/editor/server'),
      ])
      if (closed || room.closed) return
      room.editor = new TiptapEditor({
        element: document.createElement('div'),
        extensions: [...serverEditorExtensions(), Collaboration.configure({ document: room.ydoc, field: 'default' })],
        content: '',
      })
    }
    if (closed || room.closed) return
    room.ready = true
    if (!isMemo) applyFile(room)
    notify(room)
  }

  const unsubscribe = store.subscribe(event => {
    if (event.type !== 'files' && event.type !== 'reset') return
    for (const room of rooms.values()) {
      if (!event.path || event.path === room.path) applyFile(room)
    }
  })

  return {
    open(identity, onState) {
      if (closed) throw new Error('데모 작업 공간이 닫혔습니다.')
      const key = identity.project === SHARED_MEMO_PROJECT ? `${SHARED_MEMO_PROJECT}:${identity.path}` : store.canonicalFilePath(identity.path, identity.project)
      let room = rooms.get(key)
      if (!room) {
        const ydoc = new Y.Doc()
        room = { ydoc, awareness: new Awareness(ydoc), path: key, content: '', ready: false, closed: false, listeners: new Set() }
        rooms.set(key, room)
        const pendingRoom = room
        void prepare(pendingRoom).catch(error => {
          if (pendingRoom.closed || closed) return
          console.error('Demo document could not be initialized.', error)
        })
      }
      const activeRoom = room
      const name = identity.authEmail?.split('@')[0] ?? 'visitor'
      activeRoom.awareness.setLocalStateField('user', { name, color: identityColor(identity.authEmail ?? 'visitor@example.test') })
      activeRoom.listeners.add(onState)
      onState(state(activeRoom))
      return { close() { activeRoom.listeners.delete(onState); if (!activeRoom.listeners.size) activeRoom.awareness.setLocalState(null) } }
    },
    close() {
      if (closed) return
      closed = true
      unsubscribe()
      for (const room of rooms.values()) {
        room.closed = true
        room.editor?.destroy()
        room.awareness.destroy()
        room.ydoc.destroy()
        room.listeners.clear()
      }
      rooms.clear()
    },
  }
}
