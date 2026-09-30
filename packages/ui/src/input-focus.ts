/** Opening UI must not summon a software keyboard on mobile/touch devices. */
export function canAutoFocusInput(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)').matches
}
