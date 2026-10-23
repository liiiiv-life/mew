import type { ActiveMewSessions } from '../../shared/active-sessions'

const normalizedEmail = (email: string | null | undefined) => email?.trim().toLowerCase() ?? ''

export function otherConnectedPeople(presence: ActiveMewSessions | null, currentEmail: string | null): number {
  if (!presence) return 0
  const ownEmail = normalizedEmail(currentEmail) || normalizedEmail(presence.sessions.find(session => session.id === presence.selfId)?.email)
  const accounts = new Set<string>()
  let guests = 0
  for (const session of presence.sessions) {
    if (session.id === presence.selfId) continue
    const email = normalizedEmail(session.email)
    if (!email) guests++
    else if (email !== ownEmail) accounts.add(email)
  }
  return accounts.size + guests
}
