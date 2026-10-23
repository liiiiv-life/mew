import type { ButtonHTMLAttributes } from 'react'
import { Xmark } from 'iconoir-react'

export function PanelCloseButton({ className = '', 'aria-label': label, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" aria-label={label} data-tip={label}
    className={`mx-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-secondary hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40 ${className}`}>
    <Xmark width={14} height={14} aria-hidden="true" />
  </button>
}
