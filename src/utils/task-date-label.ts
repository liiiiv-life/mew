import type { TaskItem } from '../../shared/task-list.ts'
import { toDay } from './task-timeline.ts'

export function taskDateLabel(task: TaskItem, today: string): { label: string; tone: 'muted' | 'normal' | 'danger' } {
  if (task.startDate && task.startDate > today) return { label: '시작 전', tone: 'muted' }
  if (!task.date) return { label: '일정 없음', tone: 'muted' }
  const days = toDay(task.date) - toDay(today)
  return { label: days === 0 ? 'D-Day' : days > 0 ? `D-${days}` : `D+${-days}`, tone: days < 0 ? 'danger' : 'normal' }
}
