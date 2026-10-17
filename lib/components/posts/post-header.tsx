'use client'

import { formatDistance } from 'date-fns/formatDistance'
import { ExternalLink } from 'lucide-react'
import { FC } from 'react'

import { Status } from '@/lib/types/domain/status'
import { cn } from '@/lib/utils'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

import { ActorInfo } from './actor'
import { formatCompactRelativeTime } from './compactRelativeTime'

interface PostHeaderProps {
  status: Status
  currentTime: number
  onOpenStatus?: (status: Status) => void
  /**
   * The last post of a combined run. The header then shows the span the run
   * covers ("16m – 10m", first to last) in place of one post's time; the
   * timestamp still opens `status`, the first post.
   */
  lastStatus?: Status
  /**
   * The post a page is about (the status detail), rather than a row in a feed
   * or a thread. Its header row is centred on the avatar, as the design
   * system's Status detail board draws it, where a feed row aligns the header
   * to the avatar's top edge.
   */
  focused?: boolean
}

const timestampClassName = 'text-muted-foreground text-xs whitespace-nowrap'

/** The author, time and "open original" link line above a post's content. */
export const PostHeader: FC<PostHeaderProps> = ({
  status,
  currentTime,
  onOpenStatus,
  lastStatus,
  focused
}) => {
  const actualStatus = getActualStatus(status)
  const externalStatusUrl = actualStatus.url || actualStatus.id
  const showExternalLink =
    !actualStatus.isLocalActor && Boolean(externalStatusUrl)
  // The header shows the compact form ("35m", "2h", "3d"); the accessible name
  // of the timestamp button keeps the spelled-out distance, which a screen
  // reader says better than "35m".
  const relativeCreatedAt = formatDistance(actualStatus.createdAt, currentTime)
  const compactCreatedAt = formatCompactRelativeTime(
    actualStatus.createdAt,
    currentTime
  )
  const lastActual = lastStatus ? getActualStatus(lastStatus) : null
  const compactLastCreatedAt = lastActual
    ? formatCompactRelativeTime(lastActual.createdAt, currentTime)
    : null
  // A run inside one bucket ("6h – 6h") reads as a single time.
  const compactLabel =
    compactLastCreatedAt && compactLastCreatedAt !== compactCreatedAt
      ? `${compactCreatedAt} – ${compactLastCreatedAt}`
      : compactCreatedAt
  const spokenSpan = lastActual
    ? `, last post ${formatDistance(lastActual.createdAt, currentTime)} ago`
    : ''
  const actorName = actualStatus.actor
    ? actualStatus.actor.name || actualStatus.actor.username
    : null
  const openStatusLabel = actorName
    ? `Open status by ${actorName}, posted ${relativeCreatedAt} ago${spokenSpan}`
    : `Open status, posted ${relativeCreatedAt} ago${spokenSpan}`

  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm',
        // 10px = half of the 40px avatar minus half of this 20px row,
        // so the name line sits on the avatar's centre.
        focused && 'mt-2.5'
      )}
    >
      <ActorInfo
        actor={actualStatus.actor}
        actorId={actualStatus.actorId}
        statusUrl={actualStatus.url}
        // When the header wraps, the timestamp button's 32px box
        // reaches 6px up over the author link and, being later in the
        // DOM, would win the hit test there. A positioned element
        // paints above an unpositioned one without creating a stacking
        // context, so the whole link stays clickable.
        className="relative"
      />
      <span className="text-muted-foreground">·</span>
      {onOpenStatus ? (
        <button
          type="button"
          // `min-h-8` keeps the 32px tap target; the `-my-2` cancels what
          // that adds to the layout (32 - 16 of text, split over the two
          // sides), so the button no longer stretches the 20px header
          // row and the body text starts where the design draws it.
          className={`${timestampClassName} -mx-1 -my-2 inline-flex min-h-8 items-center rounded-sm px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
          aria-label={openStatusLabel}
          onClick={() => {
            onOpenStatus(status)
          }}
        >
          {compactLabel}
        </button>
      ) : (
        // No button name to carry the long form here, so it rides along
        // as visually hidden text and the compact form is hidden from
        // assistive tech: a reader says "35 minutes ago", not "35m".
        // Both come from the same `currentTime`, so the server and the
        // browser render the same text.
        <span className={timestampClassName}>
          <span aria-hidden="true">{compactLabel}</span>
          <span className="sr-only">{`${relativeCreatedAt} ago${spokenSpan}`}</span>
        </span>
      )}
      {showExternalLink && (
        <a
          href={externalStatusUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
          aria-label="Open original post"
          title="Open original post"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  )
}
