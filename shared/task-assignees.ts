import type { TaskItem } from './task-list.ts'

export const TASK_ASSIGNEE_LIMIT = 100
export const taskAssignees = (task: TaskItem): string[] => task.assignees ?? []
export const sameAssignees = (a: string[] = [], b: string[] = []): boolean => a.length === b.length && a.every((email, index) => email === b[index])
export const validAssignees = (value: unknown): value is string[] => Array.isArray(value) && value.length <= TASK_ASSIGNEE_LIMIT
  && value.every(email => typeof email === 'string' && email.length <= 254 && email === email.trim().toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  && new Set(value).size === value.length
