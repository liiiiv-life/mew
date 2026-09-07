import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { resolveProjectPath } from './paths.ts'

export const ASSET_DIR = '.mew/assets'
const ASSET_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\.[a-z0-9]{1,16})?$/i
const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/ogg': '.ogv',
  'video/webm': '.webm',
}

/** 공개 asset URL이 임의 프로젝트 파일을 읽는 통로가 되지 않도록 UUID 파일만 허용한다. */
export function isLocalAssetPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/')
  return normalized.startsWith(`${ASSET_DIR}/`) && ASSET_NAME_RE.test(normalized.slice(ASSET_DIR.length + 1))
}

function safeExtension(originalName: string, contentType: string): string {
  const ext = path.extname(path.basename(originalName.replace(/\\/g, '/'))).toLowerCase()
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : (MIME_EXTENSIONS[contentType.toLowerCase()] ?? '')
}

/** multer 임시 파일을 프로젝트의 .mew/assets로 옮기고 프로젝트 상대 경로를 돌려준다. */
export function moveAssetIntoProject(project: string, tempPath: string, originalName: string, contentType: string): string {
  const relPath = `${ASSET_DIR}/${crypto.randomUUID()}${safeExtension(originalName, contentType)}`
  const destination = resolveProjectPath(project, relPath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  try {
    fs.renameSync(tempPath, destination)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    fs.copyFileSync(tempPath, destination)
    fs.unlinkSync(tempPath)
  }
  return relPath
}
