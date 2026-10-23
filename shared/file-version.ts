/** A stat-derived revision. Older clients and preview fixtures may only have size/mtime. */
export type FileVersion = {
  size: number
  mtimeMs: number
  ctimeMs?: number
  tag?: string
}
