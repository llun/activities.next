import type { ConnectionSnapshot } from '@/lib/client/connection'

export interface SlotMessage {
  kind: 'offline' | 'unreachable'
  title: string
  detail?: string
  retry?: boolean
}

/**
 * What the status slot says, as a pure function. The bar, the strip and the
 * announcer all render from this one function, so the copy never forks. It is
 * the extension point for the send queue: a later input adds the `sending` and
 * `result` kinds, which take precedence over a connection message.
 *
 * `null` means the slot is hidden (online).
 */
export const getSlotMessage = (
  snapshot: ConnectionSnapshot,
  host: string,
  now: number = Date.now()
): SlotMessage | null => {
  if (snapshot.state === 'online') return null
  if (snapshot.state === 'offline') {
    return { kind: 'offline', title: "You're offline." }
  }

  let detail: string | undefined
  if (snapshot.probing) {
    detail = 'Trying again now'
  } else if (snapshot.nextProbeAt !== null) {
    const seconds = Math.max(1, Math.ceil((snapshot.nextProbeAt - now) / 1000))
    detail = `Trying again in ${seconds} s`
  }
  return {
    kind: 'unreachable',
    title: `Can't reach ${host}.`,
    detail,
    retry: true
  }
}
