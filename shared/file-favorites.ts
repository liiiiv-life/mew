import type { CloudStorageFolder } from './cloud-storage.ts'

export type FavoriteKind = 'home' | 'wsl-home' | 'drive' | 'desktop' | 'downloads' | 'documents' | 'pictures' | 'music' | 'movies' | 'cloud' | 'custom'
export interface FileFavorite {
  path: string
  name: string
  kind: FavoriteKind
  /** Windows profile or sync account, when a default folder belongs to one. */
  account?: string
  provider?: CloudStorageFolder['provider']
}
export interface FileFavoritePreferences { added: string[]; hidden: string[] }
