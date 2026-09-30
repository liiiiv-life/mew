export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done'
export type ProjectTask = { id: string; title: string; milestoneId: string | null; status: TaskStatus; due: string | null; parentId?: string | null; priority?: 'low' | 'medium' | 'high' | null; time?: string | null }
export type ProjectMilestone = { id: string; title: string; due: string | null }
export type ProjectTaskBoard = { revision: number; tasks: ProjectTask[]; milestones: ProjectMilestone[] }
export type ProjectTaskResponse = ProjectTaskBoard & { canEdit: boolean }
