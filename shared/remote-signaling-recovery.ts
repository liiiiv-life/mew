import type { SignalStorage } from './remote-signaling-state.ts'

/** Stores only disconnected signaling sessions, bounded by the existing peer limit and lease. */
export class RemoteSignalingRecovery<T extends { connection: string; expires: number }> {
  private storage: SignalStorage

  constructor(storage: SignalStorage) {
    this.storage = storage
    storage.sql.exec('CREATE TABLE IF NOT EXISTS mew_signal_recovery(connection TEXT PRIMARY KEY, expires INTEGER NOT NULL, state TEXT NOT NULL)')
  }

  all(): T[] {
    return this.storage.sql.exec<{ state: string }>('SELECT state FROM mew_signal_recovery').toArray().map(row => JSON.parse(row.state) as T)
  }

  get(connection: string): T | undefined {
    const row = this.storage.sql.exec<{ state: string }>('SELECT state FROM mew_signal_recovery WHERE connection=?', connection).toArray()[0]
    return row ? JSON.parse(row.state) as T : undefined
  }

  put(state: T): boolean {
    return this.storage.transactionSync(() => {
      if (state.expires <= Date.now() || (!this.get(state.connection) && this.all().length >= 8)) return false
      this.storage.sql.exec('INSERT INTO mew_signal_recovery(connection,expires,state) VALUES(?,?,?) ON CONFLICT(connection) DO UPDATE SET expires=excluded.expires,state=excluded.state', state.connection, state.expires, JSON.stringify(state))
      return true
    })
  }

  delete(connection: string): void {
    this.storage.sql.exec('DELETE FROM mew_signal_recovery WHERE connection=?', connection)
  }
}
