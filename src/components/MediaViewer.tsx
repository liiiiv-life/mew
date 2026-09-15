import { lazy, Suspense } from 'react'
import { downloadUrl, externalDownloadUrl, externalRawUrl, rawUrl } from '../api/client'
import { SheetViewer } from './SheetViewer'
import { DownloadLink } from './DownloadLink'
import type { MediaKind } from '../utils/media'
import { externalAbsolutePath, externalFileName, isExternalTabPath } from '../utils/externalFiles'
import { useI18n } from '../i18n'

const PdfViewer = lazy(() => import('./pdf-viewer'))

/** 바이너리 미디어 탭 본문 — 내용은 /api/raw에서 브라우저가 직접 스트리밍한다 */
export function MediaViewer({ path, kind, project, identity = 'guest', onEdit }: { path: string; kind: MediaKind; project?: string; identity?: string; onEdit?: () => void }) {
  const { t } = useI18n()
  const external = isExternalTabPath(path)
  const absolute = externalAbsolutePath(path)
  const src = external ? externalRawUrl(absolute) : rawUrl(path, project)
  const download = external ? externalDownloadUrl(absolute) : downloadUrl(path, project)
  const name = external ? externalFileName(path) : path.split('/').pop() ?? path

  if (kind === 'download') {
    // 미리보기가 없는 바이너리(APK/AAB 등) — /download는 Content-Disposition attachment로 확실하게 저장된다
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
        <span className="max-w-md truncate text-sm text-ink-muted">{name}</span>
        <DownloadLink href={download} name={name} className="rounded-md bg-accent px-4 py-2 text-sm text-white hover:opacity-90">
          {t('media.download')}
        </DownloadLink>
        <span className="text-xs text-ink-muted">{t('media.downloadOnly')}</span>
      </div>
    )
  }

  if (kind === 'sheet') {
    return <SheetViewer path={path} rawSrc={src} downloadSrc={download} />
  }

  if (kind === 'pdf') {
    return <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-ink-secondary" role="status">{t('pdf.loading')}</div>}><PdfViewer src={src} download={download} name={name} identity={identity} onEdit={onEdit} /></Suspense>
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
        <DownloadLink href={src} name={name} className="text-accent hover:underline">
          {t('media.download')}
        </DownloadLink>
      </div>
    </div>
  )
}
