import path from 'node:path'
import * as Y from 'yjs'
import { DATA_DIR, readJsonFile, writeFileAtomic } from './dataDir.ts'
import { createRoomDoc, type RoomDoc } from './roomDoc.ts'

/** Persist CRDT identities as well as text, so reconnecting clients can merge safely. */
export function createSharedMemoDoc(file = path.join(DATA_DIR, 'shared-memo.json')): RoomDoc {
  let doc = createRoomDoc()
  try {
    const saved = readJsonFile<{ version: number; update: string }>(file)
    if (saved) {
      if (saved.version !== 1 || typeof saved.update !== 'string' || !saved.update) throw new Error('Invalid shared memo')
      doc.applyUpdate(Buffer.from(saved.update, 'base64'))
    } else {
      const seed = new Y.Doc()
      seed.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])
      doc.applyUpdate(Y.encodeStateAsUpdate(seed))
      seed.destroy()
      writeFileAtomic(file, JSON.stringify({ version: 1, update: Buffer.from(doc.encodeStateAsUpdate()).toString('base64') }))
    }
  } catch (error) { doc.destroy(); throw error }
  return {
    stateVector: () => doc.stateVector(),
    encodeStateAsUpdate: vector => doc.encodeStateAsUpdate(vector),
    applyUpdate(update) {
      // Publish only durably saved changes. Failed writes leave the live room untouched.
      const next = createRoomDoc()
      try {
        next.applyUpdate(doc.encodeStateAsUpdate())
        const diff = next.applyUpdate(update)
        const snapshot = next.encodeStateAsUpdate()
        if (Buffer.from(snapshot).equals(Buffer.from(doc.encodeStateAsUpdate()))) { next.destroy(); return null }
        writeFileAtomic(file, JSON.stringify({ version: 1, update: Buffer.from(snapshot).toString('base64') }))
        doc.destroy()
        doc = next
        return diff
      } catch (error) { next.destroy(); throw error }
    },
    destroy: () => doc.destroy(),
  }
}
