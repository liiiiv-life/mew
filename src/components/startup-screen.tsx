import { uiText } from '@mew/ui/i18n-core'

export function PanelLoading() {
  return <div role="status" aria-label={uiText('불러오는 중…')} aria-busy="true" className="mew-panel-surface flex h-full min-h-0 flex-1 flex-col bg-surface">
    <div aria-hidden="true" className="h-9 shrink-0 border-b border-edge bg-surface-deep" />
    <div aria-hidden="true" className="flex flex-col gap-2 p-3">
      <div className="h-2 w-2/3 rounded bg-surface-raised" />
      <div className="h-2 w-1/2 rounded bg-surface-raised" />
      <div className="h-2 w-1/3 rounded bg-surface-raised" />
    </div>
  </div>
}

export function StartupScreen() {
  return <div data-startup-screen role="status" aria-busy="true" className="mew-workspace flex h-dvh items-center justify-center overflow-hidden px-4 text-center text-sm text-ink">
    <span>{uiText('접속 중…')}</span>
  </div>
}
