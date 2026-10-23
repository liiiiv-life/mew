import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { FileVersion } from '../shared/file-version.ts'

export function textFileVersion(absPath: string, stat: fs.Stats): FileVersion {
  const tag = createHash('sha256')
    .update(JSON.stringify([path.resolve(absPath), stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs]))
    .digest('base64url')
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, tag }
}

/** Never associate content read during a concurrent write with a reusable revision. */
export async function readStableTextFile(absPath: string, initialStat?: fs.Stats): Promise<{ content: string; version: FileVersion }> {
  let before = initialStat ?? await fs.promises.stat(absPath)
  let result: { content: string; version: FileVersion }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const content = await fs.promises.readFile(absPath, 'utf8')
    const after = await fs.promises.stat(absPath)
    const version = textFileVersion(absPath, after)
    if (textFileVersion(absPath, before).tag === version.tag) return { content, version }
    result = { content, version: { size: version.size, mtimeMs: version.mtimeMs, ctimeMs: version.ctimeMs } }
    before = after
  }
  return result!
}
