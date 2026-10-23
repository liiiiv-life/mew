import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useI18n } from '../i18n'

/** Keep a failed Hotview inside its document so tabs and Plain remain usable. */
export class MarkdownErrorBoundary extends Component<{
  children: ReactNode
  resetKey: string
  onOpenPlain: () => void
}, { error: Error | null; resetKey: string }> {
  state: { error: Error | null; resetKey: string } = { error: null, resetKey: '' }

  static getDerivedStateFromProps(props: { resetKey: string }, state: { resetKey: string }) {
    return props.resetKey === state.resetKey ? null : { error: null, resetKey: props.resetKey }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[mew:markdown] Hotview failed', error, info.componentStack)
  }

  render() {
    return this.state.error
      ? <MarkdownError onOpenPlain={this.props.onOpenPlain} />
      : this.props.children
  }
}

function MarkdownError({ onOpenPlain }: { onOpenPlain: () => void }) {
  const { t } = useI18n()
  return (
    <div role="alert" className="flex h-full flex-col items-start justify-center gap-3 overflow-auto p-6 text-sm text-ink">
      <p>{t('editor.markdownError')}</p>
      <p className="text-ink-secondary">{t('editor.markdownRecovery')}</p>
      <button type="button" onClick={onOpenPlain} className="rounded bg-accent px-3 py-2 text-ink-on-accent hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        {t('editor.openPlain')}
      </button>
    </div>
  )
}
