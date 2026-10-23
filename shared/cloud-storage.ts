export interface CloudStorageFolder {
  provider: 'onedrive' | 'google-drive' | 'icloud' | 'dropbox'
  name: string
  path: string
}
