import { useEffect, useState } from 'react'
import { SelectField } from '@mew/ui'
import { searchFileNames } from '../api/client'
import { WORKSPACE_PROJECT } from '../utils/active-project'
import { useI18n } from '../i18n'

export function DebuggerSourceField({ root, value, onChange, label }: { root: string; value: string; onChange: (path: string) => void; label: string }) {
  const { t } = useI18n()
  const query = value.trim().replace(/^@/, '')
  const [result, setResult] = useState<{ query: string; root: string; paths: string[]; error?: string } | null>(null)
  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void searchFileNames(query, { caseSensitive: false }, controller.signal).then(response => {
        if (!controller.signal.aborted) setResult({ query, root, paths: response.results.filter(file => file.project === WORKSPACE_PROJECT).map(file => file.path) })
      }, error => {
        if (!controller.signal.aborted) setResult({ query, root, paths: [], error: error instanceof Error ? error.message : String(error) })
      })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, root])
  const current = result?.query === query && result.root === root ? result : null
  const options = current?.paths.length
    ? current.paths.map(path => ({ value: path, label: path }))
    : query ? [{ value: '', label: current?.error ?? t(current ? 'fileExplorer.noMatches' : 'common.loading'), disabled: true }] : []
  return <SelectField editable compact label={label} placeholder={label} value={value} onChange={onChange} options={options} className="min-w-0 flex-1" />
}
