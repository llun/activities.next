import { Heart, Repeat2, Reply } from 'lucide-react'
import { FC } from 'react'

import { Status } from '@/lib/types/domain/status'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

interface ReadOnlyStatsProps {
  status: Status
}

/**
 * Non-interactive engagement row for read-only post previews (e.g. the
 * logged-out landing feed). Mirrors the action row's layout but renders plain
 * counts instead of buttons. Boost/like come from the status totals; the reply
 * count is omitted because `replies` isn't hydrated on timeline statuses, so
 * the reply affordance shows as an icon only.
 */
export const ReadOnlyStats: FC<ReadOnlyStatsProps> = ({ status }) => {
  const actualStatus = getActualStatus(status)
  return (
    <div
      className="mt-3 flex items-center gap-6 text-xs text-muted-foreground"
      aria-label="Engagement"
    >
      <span className="inline-flex items-center gap-1.5" title="Replies">
        <Reply className="size-4" aria-hidden="true" />
        <span className="sr-only">Replies</span>
      </span>
      <span
        className="inline-flex items-center gap-1.5"
        title={`${actualStatus.totalShares ?? 0} boosts`}
      >
        <Repeat2 className="size-4" aria-hidden="true" />
        <span className="tabular-nums">{actualStatus.totalShares ?? 0}</span>
        <span className="sr-only">boosts</span>
      </span>
      <span
        className="inline-flex items-center gap-1.5"
        title={`${actualStatus.totalLikes ?? 0} likes`}
      >
        <Heart className="size-4" aria-hidden="true" />
        <span className="tabular-nums">{actualStatus.totalLikes ?? 0}</span>
        <span className="sr-only">likes</span>
      </span>
    </div>
  )
}
