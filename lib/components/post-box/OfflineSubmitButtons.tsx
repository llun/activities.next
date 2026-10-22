'use client'

import { FC } from 'react'

import type { ConnectionState } from '@/lib/client/connection'
import { Button } from '@/lib/components/ui/button'

/** Video is never queued (too large to hold for a later send). */
export const getQueueDisabledReason = (
  attachments: ReadonlyArray<{ mediaType: string }>
): string | undefined =>
  attachments.some((item) => item.mediaType.startsWith('video/'))
    ? "Videos stay as drafts. Post this when you're back online."
    : undefined

interface ButtonsProps {
  onSaveDraft: () => void
  onQueue: () => void
  /** Nothing to hand over yet, or a hand-off is running. */
  disabled: boolean
  /** Why "Send when online" is unavailable; shown by `OfflineSubmitCaption`. */
  queueDisabledReason?: string
  /** The id of the element carrying `queueDisabledReason`. */
  reasonId?: string
}

/**
 * Takes the place of Post while the connection is down: keep the post as a
 * draft, or let it go out by itself once back online. The unavailable queue
 * button stays focusable (`aria-disabled`), so its reason can be read.
 */
export const OfflineSubmitButtons: FC<ButtonsProps> = ({
  onSaveDraft,
  onQueue,
  disabled,
  queueDisabledReason,
  reasonId
}) => (
  <>
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onSaveDraft}
    >
      Save draft
    </Button>
    <Button
      type="button"
      size="sm"
      disabled={disabled}
      aria-disabled={queueDisabledReason ? true : undefined}
      aria-describedby={queueDisabledReason ? reasonId : undefined}
      className={queueDisabledReason ? 'opacity-50' : undefined}
      onClick={queueDisabledReason ? undefined : onQueue}
    >
      Send when online
    </Button>
  </>
)

interface CaptionProps {
  state: Exclude<ConnectionState, 'online'>
  hasPoll: boolean
  queueDisabledReason?: string
  reasonId?: string
}

/** Rendered under the toolbar row, not inside the button group. */
export const OfflineSubmitCaption: FC<CaptionProps> = ({
  state,
  hasPoll,
  queueDisabledReason,
  reasonId
}) => (
  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
    <p>
      {state === 'unreachable' ? "Can't reach the server." : "You're offline."}{' '}
      Posts you choose to send will go out when you&apos;re back online, while
      this app is open.
      {hasPoll ? " The poll's duration starts when it's sent." : ''}
    </p>
    {queueDisabledReason ? <p id={reasonId}>{queueDisabledReason}</p> : null}
  </div>
)
