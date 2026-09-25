import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useOverlayDismiss } from '@mew/ui'
import { useI18n } from '../i18n'

export function FileActionMenu({
  x,
  y,
  onRename,
  onDuplicate,
  onCopyClip,
  onCutClip,
  onPasteClip,
  onDownload,
  onDelete,
  onNewFile,
  onNewFolder,
  onUpload,
  onInitGit,
  onCreateSubproject,
  onAddFavorite,
  onOpenProject,
  pasteDisabled = false,
  onClose,
}: {
  x: number
  y: number
  /** 루트(빈 공간) 메뉴에서는 대상 경로가 없어 undefined로 숨긴다 */
  onRename?: () => void
  /** 복제 — 파일에만 제공(폴더는 undefined로 숨긴다) */
  onDuplicate?: () => void
  onCopyClip?: () => void
  onCutClip?: () => void
  /** 클립보드에 담긴 항목이 있을 때만 제공 — 없으면 undefined로 숨긴다 */
  onPasteClip?: () => void
  onDownload?: ReactNode
  onDelete?: () => void
  onNewFile?: () => void
  onNewFolder?: () => void
  onUpload?: () => void
  onInitGit?: () => void
  onCreateSubproject?: () => void
  onAddFavorite?: () => void
  onOpenProject?: () => void
  pasteDisabled?: boolean
  onClose: () => void
}) {
  const { t } = useI18n()
  useOverlayDismiss(onClose)
  const ref = useRef<HTMLDivElement>(null)
  // 항목 개수(파일/폴더/루트)마다 실제 높이가 달라 고정 상수로는 못 잡는다 —
  // 렌더된 실측 크기로 보이는 화면과 모바일 독 사이에 배치한다.
  const [pos, setPos] = useState({ left: x, top: y, maxHeight: 0, maxWidth: 0 })

  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      e.preventDefault()
      e.stopPropagation()
      onClose()
      // 팝오버를 닫은 이 상호작용이 그 아래 요소의 클릭(파일 열기/폴더 토글 등)까지
      // 이어지지 않도록, 뒤따라올 click 이벤트 하나를 캡처 단계에서 삼킨다.
      function swallowClick(ce: MouseEvent) {
        ce.preventDefault()
        ce.stopPropagation()
        clear()
      }
      function clear() {
        document.removeEventListener('click', swallowClick, true)
        document.removeEventListener('pointerdown', clear, true)
        clearTimeout(timer)
      }
      document.addEventListener('click', swallowClick, { capture: true, once: true })
      document.addEventListener('pointerdown', clear, { capture: true, once: true })
      const timer = setTimeout(clear, 1000)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [onClose])

  useLayoutEffect(() => {
    const menu = ref.current
    if (!menu) return
    const viewport = window.visualViewport
    const place = () => {
      const left = (viewport?.offsetLeft ?? 0) + 4
      const top = (viewport?.offsetTop ?? 0) + 4
      const right = left + (viewport?.width ?? window.innerWidth) - 8
      let bottom = top + (viewport?.height ?? window.innerHeight) - 8
      if (window.matchMedia('(width < 768px)').matches) {
        const dock = document.querySelector('.mobile-dock:not([hidden])')?.getBoundingClientRect()
        if (dock && dock.width > 0 && dock.height > 0 && dock.bottom > top) {
          bottom = Math.min(bottom, dock.top - 4)
        }
      }
      const maxHeight = Math.max(0, bottom - top)
      const maxWidth = Math.max(0, right - left)
      // Apply limits before measuring so a tall menu scrolls above the dock.
      menu.style.maxHeight = `${maxHeight}px`
      menu.style.maxWidth = `${maxWidth}px`
      menu.style.minWidth = `${Math.min(192, maxWidth)}px`
      const rect = menu.getBoundingClientRect()
      const next = {
        left: Math.max(left, Math.min(x, right - rect.width)),
        top: Math.max(top, Math.min(y, bottom - rect.height)),
        maxHeight,
        maxWidth,
      }
      setPos(previous => previous.left === next.left && previous.top === next.top
        && previous.maxHeight === maxHeight && previous.maxWidth === maxWidth ? previous : next)
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(menu)
    const dock = document.querySelector('.mobile-dock')
    if (dock) observer.observe(dock, { box: 'border-box' })
    window.addEventListener('resize', place)
    viewport?.addEventListener('resize', place)
    viewport?.addEventListener('scroll', place)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      viewport?.removeEventListener('resize', place)
      viewport?.removeEventListener('scroll', place)
    }
  }, [x, y])

  return (
    <div
      ref={ref}
      data-file-action-menu
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      style={{ position: 'fixed', ...pos, minWidth: Math.min(192, pos.maxWidth), zIndex: 1300 }}
      className="overflow-y-auto overscroll-contain rounded-lg border border-edge-bright bg-surface-raised text-sm shadow-xl"
    >
      {onRename && (
        <button type="button" onClick={onRename} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">
          {t('fileExplorer.rename')}
        </button>
      )}
      {onDuplicate && (
        <button type="button" onClick={onDuplicate} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">
          {t('fileExplorer.duplicate')}
        </button>
      )}
      {onCopyClip && (
        <button type="button" onClick={onCopyClip} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">
          {t('fileExplorer.copy')}
        </button>
      )}
      {onCutClip && (
        <button type="button" onClick={onCutClip} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">
          {t('fileExplorer.cut')}
        </button>
      )}
      {onPasteClip && (
        <button type="button" onClick={onPasteClip} disabled={pasteDisabled} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">
          {t('fileExplorer.paste')}
        </button>
      )}
      {onDownload}
      {onNewFile && (
        <button type="button" onClick={onNewFile} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">
        {t('sidebar.newFile')}
        </button>
      )}
      {onNewFolder && (
        <button type="button" onClick={onNewFolder} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">
        {t('sidebar.newFolder')}
        </button>
      )}
      {onUpload && (
        <button type="button" onClick={onUpload} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">
        {t('fileExplorer.upload')}
        </button>
      )}
      {onCreateSubproject && (
        <button type="button" onClick={onCreateSubproject} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">
          {t('fileExplorer.createSubproject')}
        </button>
      )}
      {onInitGit && (
        <button type="button" onClick={onInitGit} className="block w-full px-3 py-2 text-left hover:bg-surface-hover disabled:opacity-40">
          {t('fileExplorer.initGit')}
        </button>
      )}
      {onAddFavorite && <button type="button" onClick={onAddFavorite} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{t('favorites.add')}</button>}
      {onOpenProject && <button type="button" onClick={onOpenProject} className="block w-full px-3 py-2 text-left hover:bg-surface-hover">{t('fileExplorer.openProject')}</button>}
      {onDelete && (
        <button type="button" onClick={onDelete} className="block w-full px-3 py-2 text-left text-danger hover:bg-surface-hover">
          {t('fileExplorer.delete')}
        </button>
      )}
    </div>
  )
}
