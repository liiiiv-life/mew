import { Xmark, Notes } from 'iconoir-react'
import { Editor } from '@mew/editor'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { editorApi } from '../api/client'
import type { SharedMemoSession } from '../hooks/use-shared-memo'
import { PresenceDots } from './PresenceDots'
import { DockGrip, DockInlineBody } from './DockWorkspace'
import './shared-memo.css'

const memoApi = { ...editorApi, fetchTableLayout: undefined, saveTableLayout: undefined }

export function SharedMemo({ session, open }: { session: SharedMemoSession; open: boolean }) {
  useUiLocale()
  const { root, value, setValue, colors, collab, keyboardOpen, close, activated } = session
  return <div ref={root} role="region" aria-label={uiText('메모')} tabIndex={-1} className="shared-memo flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface text-ink">
    <header data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
      <DockGrip group="memo" />
      <div role="tab" aria-selected="true" tabIndex={0} className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-xs text-ink">
        <Notes width={14} height={14} aria-hidden="true" /><span>{uiText('메모')}</span><PresenceDots colors={colors} />
      </div>
      <button type="button" onClick={close} aria-label={uiText('닫기')} title={uiText('닫기')}
        className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
        <Xmark width={14} height={14} />
      </button>
    </header>
    <DockInlineBody group="memo" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {activated && !collab?.connected && <div role="status" className="px-3 py-2 text-xs text-ink-muted">{uiText(collab?.synced ? '재연결 중…' : '연결 중…')}</div>}
      <div className="min-h-0 flex-1">
        {collab && <Editor value={value} onChange={setValue} api={memoApi} collab={collab} readOnly={!collab.connected} showMobileKeyBar={open && keyboardOpen} />}
      </div>
    </DockInlineBody>
  </div>
}
