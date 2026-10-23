import type { TaskItem } from './task-list.ts'

export const TASK_TAG_LIMIT = 100
export const TASK_TAG_LENGTH = 64
export const normalizeTag = (tag: string): string => tag.normalize('NFC').toLocaleLowerCase('en-US')
export const validTag = (tag: unknown): tag is string => typeof tag === 'string' && tag.length > 0 && tag.length <= TASK_TAG_LENGTH && /^[\p{L}\p{N}_-]+$/u.test(tag) && normalizeTag(tag) === tag
export const taskTags = (task: TaskItem): string[] => task.tags ?? []
export const sameTags = (a: string[] = [], b: string[] = []): boolean => a.length === b.length && a.every((tag, index) => tag === b[index])
export const validTags = (tags: unknown): tags is string[] => Array.isArray(tags) && tags.length <= TASK_TAG_LIMIT && tags.every(validTag) && new Set(tags).size === tags.length
export const collectTaskTags = (tasks: TaskItem[], known: string[] = []): string[] => [...new Set([...known, ...tasks.flatMap(taskTags)])].sort((a, b) => a.localeCompare(b))

export function tagToken(text: string, caret: number): { start: number; end: number; tag: string } | null {
  const match = /(?:^|\s)#([\p{L}\p{N}_-]*)$/u.exec(text.slice(0, caret))
  if (!match || /[\p{L}\p{N}_-]/u.test(text[caret] ?? '')) return null
  return { start: caret - match[1].length - 1, end: caret, tag: normalizeTag(match[1]) }
}

/** Convert complete hashtag tokens in pasted text, leaving punctuation and URLs intact. */
export function extractTaskTags(text: string, existing: string[] = [], requireSpace = false): { text: string; tags: string[] } {
  const tags = [...existing]
  const content = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)(?=\s|$)/gu, (token, prefix: string, value: string, offset: number) => {
    if (requireSpace && !/\s/u.test(text[offset + token.length] ?? '')) return token
    const tag = normalizeTag(value)
    if (!validTag(tag) || (!tags.includes(tag) && tags.length >= TASK_TAG_LIMIT)) return token
    if (!tags.includes(tag)) tags.push(tag)
    return prefix
  })
  return { text: content, tags }
}

export const validDeletedTags = (tags: unknown): tags is string[] => Array.isArray(tags) && tags.length <= 2000 && tags.every(validTag) && new Set(tags).size === tags.length
export function removeTaskTags(tasks: TaskItem[], deleted: Iterable<string>): TaskItem[] {
  const names = new Set(deleted)
  return tasks.map(task => taskTags(task).some(tag => names.has(tag)) ? { ...task, tags: taskTags(task).filter(tag => !names.has(tag)) } : task)
}
