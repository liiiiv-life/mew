import type { ThemeSettings } from '../../shared/theme.ts'
import { mewFetch } from '../utils/remote-transport.ts'
import { json } from './response.ts'

export async function fetchAccountTheme(): Promise<ThemeSettings | null> {
  return (await mewFetch('/api/user-ui/theme').then(json<{ state: ThemeSettings | null }>)).state
}

export async function saveAccountTheme(state: ThemeSettings, initialize = false): Promise<ThemeSettings> {
  return (await mewFetch('/api/user-ui/theme', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, initialize }),
  }).then(json<{ state: ThemeSettings }>)).state
}
