import type { ReactNode } from 'react'
import { debugButton } from './debugger-helpers'

export function DebugAction({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={debugButton} aria-label={label} data-tip={label} disabled={disabled} onClick={onClick}>{children}</button>
}
