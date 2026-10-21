// Tells other tabs (and this one) that drafts changed. One BroadcastChannel,
// created lazily so a test's stub is the one in use. BroadcastChannel does not
// echo to its sender, so `postDraftsMessage` also calls this tab's subscribers
// itself. Without BroadcastChannel it is local only; other tabs re-read on
// `visibilitychange` (a listener `DraftsProvider` installs).
export const DRAFTS_CHANNEL_NAME = 'activities-drafts'

export type DraftsMessage =
  /** After any save or delete completes. */
  | { type: 'changed'; accountId: string; actorId: string; draftId: string }
  /** Other tabs stop autosaving while this account signs out. */
  | { type: 'signing-out'; accountId: string }
  | { type: 'sign-out-cancelled'; accountId: string }

type Listener = (message: DraftsMessage) => void

const listeners = new Set<Listener>()
let channel: BroadcastChannel | null = null

const isDraftsMessage = (value: unknown): value is DraftsMessage => {
  const message = value as { type?: unknown; accountId?: unknown } | null
  return (
    typeof message === 'object' &&
    message !== null &&
    (message.type === 'changed' ||
      message.type === 'signing-out' ||
      message.type === 'sign-out-cancelled') &&
    typeof message.accountId === 'string'
  )
}

const notify = (message: DraftsMessage) => {
  for (const listener of [...listeners]) listener(message)
}

const getChannel = (): BroadcastChannel | null => {
  if (channel) return channel
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    channel = new BroadcastChannel(DRAFTS_CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent) => {
      if (isDraftsMessage(event.data)) notify(event.data)
    }
  } catch {
    channel = null
  }
  return channel
}

export const postDraftsMessage = (message: DraftsMessage): void => {
  try {
    getChannel()?.postMessage(message)
  } catch {
    // Other tabs catch up on visibilitychange.
  }
  notify(message)
}

/** Tells every view (this tab's and the others') that a draft was saved or deleted. */
export const announceDraftsChanged = (
  accountId: string,
  actorId: string,
  draftId: string
): void => postDraftsMessage({ type: 'changed', accountId, actorId, draftId })

export const subscribeDraftsMessages = (listener: Listener): (() => void) => {
  getChannel()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const resetDraftsChannelForTesting = (): void => {
  listeners.clear()
  try {
    channel?.close()
  } catch {
    // already closed
  }
  channel = null
}
