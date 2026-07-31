import { downloadUrl, rawUrl } from '../api/client'
import type { MediaKind } from '../utils/media'

/** 바이너리 미디어 탭 본문 — 내용은 /api/raw에서 브라우저가 직접 스트리밍한다 */
export function MediaViewer({ path, kind }: { path: string; kind: MediaKind }) {
  const src = rawUrl(path)
  const name = path.split('/').pop() ?? path

  if (kind === 'download') {
    // 미리보기가 없는 바이너리(APK/AAB 등) — /download는 Content-Disposition attachment로 확실하게 저장된다
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
        <span className="max-w-md truncate text-sm text-ink-muted">{name}</span>
        <a href={downloadUrl(path)} download={name} className="rounded-md bg-accent px-4 py-2 text-sm text-white hover:opacity-90">
          다운로드
        </a>
        <span className="text-xs text-ink-muted">미리보기 없이 내려받는 파일</span>
      </div>
    )
  }

  if (kind === 'pdf') {
    return <iframe src={src} title={name} className="h-full w-full border-0 bg-surface" />
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 overflow-auto bg-surface p-6">
      {kind === 'image' && <img src={src} alt={name} className="max-h-full max-w-full object-contain" />}
      {kind === 'video' && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={src} controls className="max-h-full max-w-full" />
      )}
      {kind === 'audio' && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio src={src} controls className="w-full max-w-xl" />
      )}
      <div className="flex items-center gap-3 text-xs text-ink-muted">
        <span className="max-w-md truncate">{name}</span>
        {/* /download는 게스트에게 requireGuestView로만 열려 있다 — 같은 오리진 download 속성이면 /raw로도 저장된다 */}
        <a href={src} download={name} className="text-accent hover:underline">
          다운로드
        </a>
      </div>
    </div>
  )
}
