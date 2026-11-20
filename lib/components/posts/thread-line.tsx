import { FC, MouseEvent } from 'react'

import {
  getActorDisplayName,
  getActorIdMention
} from '@/lib/components/posts/actor'
import { Status } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

// The rail runs down the 40px avatar column. 19px centres its 2px line in that
// column; the dot is 10px wide, so 15px centres it too. A label line is 24px
// tall, so its centre (and the dot's) is 12px down: the dot sits at 7px.
export const RAIL_LINE = 'absolute left-[19px] w-0.5 bg-border'

interface ThreadLineSegmentProps {
  /** Position and length, e.g. `top-0 h-3` or `inset-y-0`. */
  className: string
}

/**
 * A stretch of the thread line that joins a post to the row it answers or the
 * row that answers it. Purely visual: the parent is named to screen readers
 * by the row itself.
 */
export const ThreadLineSegment: FC<ThreadLineSegmentProps> = ({
  className
}) => (
  <span
    aria-hidden="true"
    data-testid="thread-line"
    className={cn(RAIL_LINE, className)}
  />
)

/**
 * The name a "Replying to" line gives a post's author: the display name, the
 * username, or the handle its actor id carries (`Status.actor` is nullable).
 * Empty when even that yields nothing but the "@" separators.
 */
export const getReplyTargetName = (status: Status): string => {
  const actual = getActualStatus(status)
  const name =
    (actual.actor &&
      (getActorDisplayName(actual.actor) || actual.actor.username)) ||
    getActorIdMention(actual.actorId, actual.url) ||
    ''
  return name.replace(/@/g, '').trim() ? name : ''
}

/**
 * Follows an in-page `#<status id>` link the way a reader expects: scrolls to
 * the post and moves focus there, so the next Tab continues from it.
 */
export const focusStatusAnchor = (
  event: MouseEvent<HTMLAnchorElement>,
  statusId: string
) => {
  const target = document.getElementById(statusId)
  if (!target) return
  event.preventDefault()
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ block: 'start' })
  }
  target.focus({ preventScroll: true })
}
