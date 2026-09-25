import { useI18n } from '../i18n'

export function ProjectLoadingOverlay() {
  const { t } = useI18n()
  return <div role="status" aria-label={t('common.loading')}
    className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
    <span aria-hidden="true" className="block h-9 w-9 rounded-full border-2 border-ink/30 border-t-ink motion-safe:animate-spin" />
    <span className="sr-only">{t('common.loading')}</span>
  </div>
}
