import { validTag } from './task-tags.ts'
import { TaskConflict } from './task-list.ts'

export const TASK_TAG_PALETTE = [8, 20, 35, 50, 65, 78, 105, 130, 155, 175, 190, 210, 225, 250, 270, 325] as const
export type TaskTagColors = Record<string, number>
export type TaskTagColorChange = { tag: string; before: number | null; after: number }
export const tagColor = (colors: TaskTagColors, tag: string): number | null => Object.hasOwn(colors, tag) ? colors[tag] : null
export const validTagColor = (color: unknown): color is number => typeof color === 'number' && TASK_TAG_PALETTE.some(hue => hue === color)
export const validTagColors = (colors: unknown): colors is TaskTagColors => !!colors && typeof colors === 'object' && !Array.isArray(colors)
  && Object.entries(colors).length <= 2000 && Object.entries(colors).every(([tag, color]) => validTag(tag) && validTagColor(color))
export const validTagColorChanges = (changes: unknown): changes is TaskTagColorChange[] => Array.isArray(changes) && changes.length <= 2000
  && changes.every(change => change && validTag(change.tag) && (change.before === null || validTagColor(change.before)) && validTagColor(change.after))
  && new Set(changes.map(change => change.tag)).size === changes.length
export const tagColorChanges = (before: TaskTagColors, after: TaskTagColors): TaskTagColorChange[] => Object.entries(after)
  .filter(([tag, color]) => tagColor(before, tag) !== color).map(([tag, color]) => ({ tag, before: tagColor(before, tag), after: color }))

export function applyTagColorChanges(colors: TaskTagColors, changes: TaskTagColorChange[]): TaskTagColors {
  let next = { ...colors }
  for (const change of changes) {
    const current = tagColor(next, change.tag)
    if (current !== change.before && current !== change.after) throw new TaskConflict()
    next = { ...next, [change.tag]: change.after }
  }
  return next
}
