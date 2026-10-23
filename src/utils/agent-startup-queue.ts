export type AgentStartupQueueEntry<T> = Readonly<{ id: number; payload: T }>

export class AgentStartupQueue<T> {
  private entries: readonly AgentStartupQueueEntry<T>[] = Object.freeze([])
  private nextId = 1
  private pumping = false

  snapshot(): readonly AgentStartupQueueEntry<T>[] {
    return this.entries
  }

  enqueue(payload: T): number {
    const id = this.nextId++
    const entry = Object.freeze({ id, payload })
    this.entries = Object.freeze([...this.entries, entry])
    return id
  }

  remove(id: number): void {
    const entries = this.entries.filter(entry => entry.id !== id)
    if (entries.length !== this.entries.length) this.entries = Object.freeze(entries)
  }

  clear(): void {
    if (this.entries.length) this.entries = Object.freeze([])
  }

  flush(send: (payload: T) => boolean): number {
    if (this.pumping) return 0
    this.pumping = true
    let sent = 0
    try {
      while (this.entries.length) {
        const entry = this.entries[0]
        let accepted = false
        try { accepted = send(entry.payload) } catch { /* 다음 flush에서 다시 시도한다. */ }
        if (!accepted) break
        this.remove(entry.id)
        sent++
      }
    } finally {
      this.pumping = false
    }
    return sent
  }
}
