// server/tree.ts의 MEDIA_EXTENSIONS·DOWNLOAD_EXTENSIONS와 맞춰야 한다 — 트리에 노출되는 바이너리 = 뷰어로 여는 파일
// 'download'는 미리보기 없이 내려받기만 하는 종류(APK/AAB 등)
export type MediaKind = 'image' | 'audio' | 'video' | 'pdf' | 'sheet' | 'download'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv'])
const DOWNLOAD_EXTS = new Set(['apk', 'aab'])

export function mediaKind(path: string): MediaKind | null {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = name.slice(dot + 1).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'xlsx') return 'sheet'
  if (DOWNLOAD_EXTS.has(ext)) return 'download'
  return null
}
