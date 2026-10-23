import { remoteInbox } from './remote-access-inbox.ts'

export function remoteTicketInbox<T extends object>(receive: (data: string, verified: T) => Promise<void>, failed: () => void) {
  let closed = false, release: ((value: T | undefined) => void) | undefined
  const verified = new Promise<T | undefined>(resolve => { release = resolve })
  const inbox = remoteInbox(async data => {
    const value = await verified
    if (!closed && value) await receive(data, value)
  }, () => { close(); failed() })
  function close() {
    closed = true
    release?.(undefined)
    release = undefined
    inbox.close()
  }
  return {
    push: inbox.push,
    authorize(value: T) {
      if (closed || !release) return false
      release(value)
      release = undefined
      return true
    },
    close,
  }
}
