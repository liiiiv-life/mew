import type { AgentAttachmentRef } from '../../shared/agent-attachment'

const UPLOADED_ATTACHMENT_TOKEN = /\[\[([^:\]\n]+):(\.mew\/(?:temp\/assets|assets|files)\/[^\]\n]+)\]\]/g

export function uploadedAttachmentTokens(text: string): { from: number; to: number; token: string; project: string; path: string }[] {
  return [...text.matchAll(UPLOADED_ATTACHMENT_TOKEN)].map(match => ({
    from: match.index,
    to: match.index + match[0].length,
    token: match[0],
    project: match[1],
    path: match[2],
  }))
}

export function withoutAttachmentTokens(text: string): string {
  return text.replace(UPLOADED_ATTACHMENT_TOKEN, '').replace(/\[\[mew-upload:[^\]\n]+\]\]/g, '')
}

export function attachmentKind(mimeType: string, path: string): 'image' | 'video' | 'audio' | 'file' {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType && mimeType !== 'application/octet-stream') return 'file'
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  if (/^(jpe?g|png|gif|webp|svg|avif|heic|bmp|ico|tiff?)$/.test(extension)) return 'image'
  if (/^(mp4|webm|mov|m4v|avi|mkv|ogv)$/.test(extension)) return 'video'
  if (/^(mp3|wav|ogg|m4a|aac|flac|opus)$/.test(extension)) return 'audio'
  return 'file'
}

export function conversationAttachments(text: string, attachments: AgentAttachmentRef[], images: { path: string; mimeType: string }[], project: string): AgentAttachmentRef[] {
  const files = new Map<string, AgentAttachmentRef>()
  for (const file of [...attachments, ...images.map(image => ({ ...image, project }))]) {
    files.set(JSON.stringify([file.project, file.path]), file)
  }
  // Runtime transcripts can retain uploaded-file references without Mew's metadata events.
  for (const file of uploadedAttachmentTokens(text)) {
    const key = JSON.stringify([file.project, file.path])
    if (!files.has(key)) files.set(key, { project: file.project, path: file.path, mimeType: '' })
  }
  return [...files.values()]
}
