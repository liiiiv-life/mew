let activeScope = ''
let storageOverride: Storage | undefined
let sessionStorageOverride: Storage | undefined
let persistentCaches = true
export function setBrowserStorageScope(account?: string, instance?: string, options?: { storage?: Storage; sessionStorage?: Storage; persistentCaches?: boolean }) {
  activeScope = account && instance ? `mew:remote:${JSON.stringify([account, instance])}:` : ''
  storageOverride = options?.storage
  sessionStorageOverride = options?.sessionStorage
  persistentCaches = options?.persistentCaches !== false
}
export function globalBrowserStorage(): Storage { return storageOverride ?? localStorage }
export function globalSessionStorage(): Storage { return sessionStorageOverride ?? sessionStorage }
export function browserCachePersistenceEnabled(): boolean { return persistentCaches }
export function remoteStorageName(name: string) { return activeScope ? activeScope + name : name }
export function scopedBrowserStorage(): Storage {
  const storage = globalBrowserStorage(), prefix = activeScope
  if (!prefix) return storage
  const keys = () => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => !!key && key.startsWith(prefix))
  return {
    get length() { return keys().length },
    key: index => keys()[index]?.slice(prefix.length) ?? null,
    getItem: key => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: key => storage.removeItem(prefix + key),
    clear: () => { for (const key of keys()) storage.removeItem(key) },
  }
}
