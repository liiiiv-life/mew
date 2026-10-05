import { useEffect, useRef, useState, type ReactNode } from 'react'
import { flattenFiles } from '@mew/editor'
import { fetchFullTree } from '../api/client'
import { WORKSPACE_PROJECT } from '../utils/active-project'

import { TaskDocumentContext as Context } from './task-documents'

export function TaskDocumentProvider({ workspace, onOpen, children }: { workspace?: string | null; onOpen?: (path: string) => void; children: ReactNode }) {
  const [files, setFiles] = useState<string[]>([])
  const request = useRef<AbortController | null>(null)
  const loaded = useRef(false)
  useEffect(() => {
    setFiles([]); loaded.current = false
    return () => { request.current?.abort(); request.current = null }
  }, [workspace])
  const load = () => {
    if (!workspace || loaded.current || request.current) return
    const controller = new AbortController(); request.current = controller
    fetchFullTree(WORKSPACE_PROJECT, controller.signal).then(tree => {
      if (controller.signal.aborted) return
      setFiles(flattenFiles(tree)); loaded.current = true
    }).catch(() => {}).finally(() => { if (request.current === controller) request.current = null })
  }
  return <Context.Provider value={{ files, load, open: onOpen }}>{children}</Context.Provider>
}
