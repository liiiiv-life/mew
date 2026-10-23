import { MediaImage, MusicDoubleNote, Page, VideoCamera } from 'iconoir-react'
import { attachmentKind } from '../utils/agent-attachments'

export function AgentAttachmentIcon({ mimeType, path }: { mimeType: string; path: string }) {
  const kind = attachmentKind(mimeType, path)
  const Icon = kind === 'image' ? MediaImage : kind === 'video' ? VideoCamera : kind === 'audio' ? MusicDoubleNote : Page
  return <Icon width={16} height={16} aria-hidden="true" className="shrink-0" />
}
