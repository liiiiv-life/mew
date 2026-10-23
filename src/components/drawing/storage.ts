import { json } from '../../api/response'
import { mewFetch } from '../../utils/remote-transport'

export interface DrawingSummary {
  id: string
  name: string
  createdAt: string
  path: string
  bytes: number
}

export interface DrawingScope {
  drawings: DrawingSummary[]
  projectRoot: string
}

export interface SavedDrawing extends DrawingSummary {
  projectRoot: string
}

export interface StoredDrawing extends SavedDrawing {
  svg: string
}

function scopeQuery(projectRoot?: string): string {
  return projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : ''
}

/** Capture the workspace when the editor opens and pass it to subsequent requests. */
export function getDrawingScope(projectRoot?: string): Promise<DrawingScope> {
  return mewFetch(`/api/agent/drawings${scopeQuery(projectRoot)}`).then(json<DrawingScope>)
}

export async function listDrawings(projectRoot?: string): Promise<DrawingSummary[]> {
  return (await getDrawingScope(projectRoot)).drawings
}

export function loadDrawing(id: string, projectRoot?: string): Promise<StoredDrawing> {
  return mewFetch(`/api/agent/drawings/${encodeURIComponent(id)}${scopeQuery(projectRoot)}`).then(json<StoredDrawing>)
}

export function saveDrawing(svg: string, name: string, projectRoot?: string): Promise<SavedDrawing> {
  return mewFetch('/api/agent/drawings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ svg, name, ...(projectRoot ? { projectRoot } : {}) }),
  }).then(json<SavedDrawing>)
}
