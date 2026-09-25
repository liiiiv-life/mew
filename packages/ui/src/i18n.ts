import { useSyncExternalStore } from 'react'
import { getUiLocale, subscribeUiLocale } from './i18n-core.ts'

/** Subscribe without remounting editors, terminals or their unsaved state. */
export function useUiLocale() {
  return useSyncExternalStore(subscribeUiLocale, getUiLocale, getUiLocale)
}
