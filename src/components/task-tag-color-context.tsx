import { createContext, useContext } from 'react'
import type { TaskTagColors } from '../../shared/task-tag-colors'

export const TaskTagColorContext = createContext<{ colors: TaskTagColors; onChange: (tag: string, hue: number) => void; onDelete: (tag: string) => void }>({ colors: {}, onChange: () => {}, onDelete: () => {} })
export const useTaskTagColors = () => useContext(TaskTagColorContext)
