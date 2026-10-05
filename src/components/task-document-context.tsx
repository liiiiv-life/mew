import type { ReactNode } from 'react'
import { TaskDocumentContext as Context } from './task-documents'

export function TaskDocumentProvider({ onOpen, children }: { workspace?: string | null; onOpen?: (path: string) => void; children: ReactNode }) {
  return <Context.Provider value={{ files: [], load() {}, open: onOpen }}>{children}</Context.Provider>
}
