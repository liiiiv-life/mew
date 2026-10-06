import { createContext, useContext } from 'react'
import type { MemberProfile } from '../api/client'

export const TaskAssigneeContext = createContext({ members: [] as MemberProfile[], loading: false, error: false, retry: () => {} })
export const useTaskAssignees = () => useContext(TaskAssigneeContext)
