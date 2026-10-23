import type { DocumentPageMutation } from '../../shared/document-pages'

type Handler = {
  prepare(project: string): Promise<() => void>
  apply(mutation: DocumentPageMutation, project: string): void
}
let handler: Handler | undefined
let activeChanges: DocumentPageMutation[] | undefined

export function collectDatabasePageMutations(value: unknown): void {
  if (value && typeof value === 'object' && 'documentPageMutations' in value && Array.isArray(value.documentPageMutations)) activeChanges?.push(...value.documentPageMutations)
}

let queue: Promise<unknown> = Promise.resolve()

export function registerDatabasePageMutations(next: Handler): () => void {
  handler = next
  return () => { if (handler === next) handler = undefined }
}

/** Save drafts and pause autosave while a DB request may promote its owner document. */
export async function withDatabasePageMutations<T>(project: string, run: () => Promise<T>): Promise<T> {
  const current = handler
  const execute = async () => {
    if (!current) return run()
    if (handler !== current) throw new Error('프로젝트가 변경되었습니다. 다시 시도하세요.')
    const release = await current.prepare(project)
    const changes: DocumentPageMutation[] = []
    activeChanges = changes
    try {
      const value = await run()
      if (handler === current) for (const mutation of changes) current.apply(mutation, project)
      return value
    } finally { activeChanges = undefined; release() }
  }
  const result = queue.then(execute, execute)
  queue = result.catch(() => {})
  return result
}
