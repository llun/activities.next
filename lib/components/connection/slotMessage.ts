import type { ConnectionSnapshot } from '@/lib/client/connection'
import type { SendQueueProgress } from '@/lib/client/drafts/types'

export interface SlotMessage {
  kind: 'offline' | 'unreachable' | 'sending' | 'result'
  /** A failure the reader just caused (a Pause that didn't take). */
  tone?: 'error'
  title: string
  detail?: string
  retry?: boolean
}

const count = (n: number, one: string, many: string = one) =>
  `${n} ${n === 1 ? one : many}`

/** "2 posts sent · 1 needs review": the non-zero parts of a finished drain. */
const resultTitle = (queue: SendQueueProgress): string =>
  [
    queue.sent > 0 ? `${count(queue.sent, 'post', 'posts')} sent` : null,
    queue.needsReview > 0
      ? `${count(queue.needsReview, 'needs', 'need')} review`
      : null,
    queue.failed > 0 ? `${queue.failed} couldn't send` : null,
    queue.paused > 0 ? `${queue.paused} paused` : null
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

/**
 * What the status slot says, as a pure function. The bar, the strip and the
 * announcer all render from this one function, so the copy never forks. The
 * send queue's `sending` and `result` phases take precedence over a connection
 * message.
 *
 * `null` means the slot is hidden (online and nothing to report).
 */
export const getSlotMessage = (
  snapshot: ConnectionSnapshot,
  host: string,
  now: number = Date.now(),
  queue?: (SendQueueProgress & { pauseFailed?: boolean }) | null
): SlotMessage | null => {
  if (queue?.phase === 'sending') {
    return {
      kind: 'sending',
      // Constant, so the announcer says it once, not on every index change;
      // a failed Pause changes it once, so that is announced too.
      title: queue.pauseFailed ? "Couldn't pause sending." : 'Back online',
      ...(queue.pauseFailed ? { tone: 'error' as const } : {}),
      detail: `Sending ${queue.index} of ${queue.total} ${queue.total === 1 ? 'post' : 'posts'}`
    }
  }
  if (queue?.phase === 'result') {
    // An all-zero result has nothing to say.
    const title = resultTitle(queue)
    if (title) return { kind: 'result', title }
  }

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
