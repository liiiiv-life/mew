export type SignalInstance = { id: string; owner: string; name: string; publicKey: string; revoked: number }
export type SignalBrowser = { id: string; label: string; createdAt: number; lastSeen: number; revoked: number }
export type SignalSqlValue = string | number | null
export interface SignalStorage {
  sql: {
    exec<T extends Record<string, SignalSqlValue> = Record<string, SignalSqlValue>>(query: string, ...bindings: SignalSqlValue[]): { toArray(): T[] }
  }
  transactionSync<T>(callback: () => T): T
}

export class RemoteSignalingState {
  private storage: SignalStorage

  constructor(storage: SignalStorage) {
    this.storage = storage
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS mew_signal_instances(
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      publicKey TEXT NOT NULL DEFAULT '',
      revoked INTEGER NOT NULL DEFAULT 0,
      initialized INTEGER NOT NULL DEFAULT 0
    )`)
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS mew_signal_browsers(
      instance TEXT NOT NULL,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      lastSeen INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(instance,id)
    )`)
  }

  initialized(instance: string): boolean {
    return this.storage.sql.exec('SELECT 1 FROM mew_signal_instances WHERE id=? AND initialized=1', instance).toArray().length > 0
  }

  instance(instance: string): SignalInstance | null {
    return this.storage.sql.exec<SignalInstance>('SELECT id,owner,name,publicKey,revoked FROM mew_signal_instances WHERE id=? AND initialized=1 AND revoked=0', instance).toArray()[0] ?? null
  }

  seed(instance: SignalInstance, browsers: SignalBrowser[]): void {
    this.storage.transactionSync(() => {
      if (this.initialized(instance.id)) return
      this.storage.sql.exec(`INSERT INTO mew_signal_instances(id,owner,name,publicKey,revoked,initialized) VALUES(?,?,?,?,?,1)
        ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,name=excluded.name,publicKey=excluded.publicKey,
        revoked=MAX(mew_signal_instances.revoked,excluded.revoked),initialized=1`,
      instance.id, instance.owner, instance.name, instance.publicKey, instance.revoked ? 1 : 0)
      for (const browser of browsers) {
        this.storage.sql.exec(`INSERT INTO mew_signal_browsers(instance,id,label,createdAt,lastSeen,revoked) VALUES(?,?,?,?,?,?)
          ON CONFLICT(instance,id) DO UPDATE SET revoked=MAX(mew_signal_browsers.revoked,excluded.revoked)`,
        instance.id, browser.id, browser.label, browser.createdAt, browser.lastSeen, browser.revoked ? 1 : 0)
      }
    })
  }

  mergeRevocations(instance: string, active: boolean, browsers: SignalBrowser[]): void {
    this.storage.transactionSync(() => {
      if (!active) this.revokeInstance(instance)
      for (const browser of browsers) {
        if (!browser.revoked) continue
        this.storage.sql.exec(`INSERT INTO mew_signal_browsers(instance,id,label,createdAt,lastSeen,revoked) VALUES(?,?,?,?,?,1)
          ON CONFLICT(instance,id) DO UPDATE SET revoked=1`,
        instance, browser.id, browser.label, browser.createdAt, browser.lastSeen)
      }
    })
  }

  revokeInstance(instance: string): void {
    this.storage.sql.exec(`INSERT INTO mew_signal_instances(id,revoked) VALUES(?,1)
      ON CONFLICT(id) DO UPDATE SET revoked=1`, instance)
  }

  browserRevoked(instance: string, id: string): boolean {
    return this.storage.sql.exec('SELECT 1 FROM mew_signal_browsers WHERE instance=? AND id=? AND revoked=1', instance, id).toArray().length > 0
  }

  revokeBrowser(instance: string, id: string, now = Date.now()): void {
    this.storage.sql.exec(`INSERT INTO mew_signal_browsers(instance,id,label,createdAt,lastSeen,revoked) VALUES(?,?,'Browser',?,?,1)
      ON CONFLICT(instance,id) DO UPDATE SET revoked=1`, instance, id, now, now)
  }

  trustBrowser(instance: string, id: string, label: string, now = Date.now()): boolean {
    return this.storage.transactionSync(() => {
      if (!this.instance(instance)) return false
      const name = [...label].filter(character => character >= ' ' && character !== '\u007f').join('').trim().slice(0, 120) || 'Browser'
      return this.storage.sql.exec(`INSERT INTO mew_signal_browsers(instance,id,label,createdAt,lastSeen,revoked) VALUES(?,?,?,?,?,0)
        ON CONFLICT(instance,id) DO UPDATE SET label=excluded.label,lastSeen=MAX(mew_signal_browsers.lastSeen,excluded.lastSeen)
        WHERE mew_signal_browsers.revoked=0 RETURNING id`, instance, id, name, now, now).toArray().length > 0
    })
  }

  browsers(instance: string): SignalBrowser[] {
    return this.storage.sql.exec<SignalBrowser>('SELECT id,label,createdAt,lastSeen,revoked FROM mew_signal_browsers WHERE instance=? ORDER BY lastSeen DESC,id', instance).toArray()
  }
}
