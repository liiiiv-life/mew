import { useRef } from 'react'
import { Xmark, Notes } from 'iconoir-react'
import { Editor, type EditorHandle } from '@mew/editor'
import { uiText } from '@mew/ui/i18n-core'
import { useUiLocale } from '@mew/ui/i18n'
import { editorApi } from '../api/client'
import type { SharedMemoSession } from '../hooks/use-shared-memo'
import { PresenceDots } from './PresenceDots'
import { DockGrip, DockInlineBody } from './DockWorkspace'
import { CodePane } from './CodePane'
import { SHARED_MEMO_PATH } from '../../shared/shared-memo'
import './shared-memo.css'

const memoApi = { ...editorApi, fetchTableLayout: undefined, saveTableLayout: undefined }

export function SharedMemo({ session, open }: { session: SharedMemoSession; open: boolean }) {
  useUiLocale()
  const editorRef = useRef<EditorHandle>(null)
  const { root, value, setValue, viewMode, setViewMode, colors, collab, keyboardOpen, close, activated } = session
  return <div ref={root} role="region" aria-label={uiText('메모')} tabIndex={-1} className="shared-memo flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface text-ink">
    <header data-dock-tab-bar className="flex h-9 shrink-0 items-center border-b border-edge bg-surface-deep">
      <DockGrip group="memo" />
      <div role="tab" aria-selected="true" tabIndex={0} className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 text-xs text-ink">
        <Notes width={14} height={14} aria-hidden="true" /><span>{uiText('메모')}</span><PresenceDots colors={colors} />
      </div>
      <div className="flex overflow-hidden rounded border border-edge-strong">
        {(['hotview', 'plain'] as const).map(mode => <button key={mode} type="button"
          onClick={() => setViewMode(mode)} aria-pressed={viewMode === mode}
          aria-label={mode === 'hotview' ? 'Hotview' : 'Plain'} title={mode === 'hotview' ? 'Hotview' : 'Plain'}
          className={`p-1.5 ${viewMode === mode ? 'bg-accent text-ink-on-accent' : 'bg-surface-raised text-ink-secondary hover:bg-surface-hover'}`}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {mode === 'hotview' ? <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></> : <><path d="m18 16 4-4-4-4" /><path d="m6 8-4 4 4 4" /><path d="m14.5 4-5 16" /></>}
          </svg>
        </button>)}
      </div>
      <button type="button" onClick={close} aria-label={uiText('닫기')} title={uiText('닫기')}
        className="mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
        <Xmark width={14} height={14} />
      </button>
    </header>
    <DockInlineBody group="memo" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {activated && !collab?.connected && <div role="status" className="px-3 py-2 text-xs text-ink-muted">{uiText(collab?.synced ? '재연결 중…' : '연결 중…')}</div>}
      <div className="min-h-0 flex-1">
        {/* Keep the same Y.XmlFragment connected in both views; CodePane must not create a separate Y.Text. */}
        <div hidden={viewMode !== 'hotview'} className="h-full">
          {collab && <Editor ref={editorRef} value={value} onChange={setValue} api={memoApi} collab={collab} readOnly={!collab.connected} showMobileKeyBar={viewMode === 'hotview' && open && keyboardOpen} />}
        </div>
        {collab && viewMode === 'plain' && <CodePane path={SHARED_MEMO_PATH} value={value}
          onChange={content => editorRef.current?.setRawContent(content)} readOnly={!collab.connected} />}
      </div>
    </DockInlineBody>
  </div>
}
