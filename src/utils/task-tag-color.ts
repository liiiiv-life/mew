import type { TaskTagColors } from '../../shared/task-tag-colors'
import { optionHue } from '../../shared/selection-options'
export function taskTagHue(tag: string, colors: TaskTagColors = {}): number {
  return optionHue(tag, colors)
}
