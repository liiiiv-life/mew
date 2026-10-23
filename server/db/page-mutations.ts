import { AsyncLocalStorage } from 'node:async_hooks'
import type { DocumentPageMutation } from '../../shared/document-pages.ts'

const mutations = new AsyncLocalStorage<DocumentPageMutation[]>()

export function capturePageMutations<T>(run: (changes: DocumentPageMutation[]) => T): T {
  const changes: DocumentPageMutation[] = []
  return mutations.run(changes, () => run(changes))
}

export function recordPageMutation(change: DocumentPageMutation | undefined): void {
  if (change) mutations.getStore()?.push(change)
}
