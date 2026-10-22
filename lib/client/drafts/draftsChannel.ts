// Tells other tabs (and this one) that drafts changed. One BroadcastChannel,
// created lazily so a test's stub is the one in use. BroadcastChannel does not
// echo to its sender, so `postDraftsMessage` also calls this tab's subscribers
// itself. Without BroadcastChannel it is local only; other tabs re-read on
// `visibilitychange` (a listener `DraftsProvider` installs).
import type { SendQueueProgress } from './types'

export const DRAFTS_CHANNEL_NAME = 'activities-drafts'

export type DraftsMessage =
  /** After any save or delete completes. */
  | { type: 'changed'; accountId: string; actorId: string; draftId: string }
  /** Other tabs stop autosaving while this account signs out. */
  | { type: 'signing-out'; accountId: string }
  | { type: 'sign-out-cancelled'; accountId: string }
  /** The sending tab's progress; every tab shows it in the status slot. */
  | {
      type: 'queue-progress'
      accountId: string
      actorId: string
      progress: SendQueueProgress
    }

type Listener = (message: DraftsMessage) => void

const listeners = new Set<Listener>()
let channel: BroadcastChannel | null = null

const PHASES = ['idle', 'sending', 'result']
const COUNTS = ['index', 'total', 'sent', 'needsReview', 'failed', 'paused']

const isProgress = (value: unknown): value is SendQueueProgress => {
  const progress = value as Record<string, unknown> | null
  return (
    typeof progress === 'object' &&
    progress !== null &&
    PHASES.includes(progress.phase as string) &&
    COUNTS.every((key) => typeof progress[key] === 'number')
  )
}

export const isDraftsMessage = (value: unknown): value is DraftsMessage => {
  const message = value as Record<string, unknown> | null
  if (
    typeof message !== 'object' ||
    message === null ||
    typeof message.accountId !== 'string'
  ) {
    return false
  }
  switch (message.type) {
    case 'changed':
    case 'signing-out':
    case 'sign-out-cancelled':
      return true
    case 'queue-progress':
      return typeof message.actorId === 'string' && isProgress(message.progress)
    default:
      return false
  }
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
