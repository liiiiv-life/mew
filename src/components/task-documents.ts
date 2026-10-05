import { createContext, useContext } from 'react'

export const TaskDocumentContext = createContext<{ files: string[]; load: () => void; open?: (path: string) => void }>({ files: [], load() {} })
export const useTaskDocuments = () => useContext(TaskDocumentContext)
