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
// Pluralize the engagement noun. The count is rendered separately (a visible,
// screen-reader-read number), so the sr-only span carries only the noun — the
// reader announces e.g. "4 boosts" without repeating the count.
const pluralNoun = (count: number, noun: string) =>
  count === 1 ? noun : `${noun}s`

export const ReadOnlyStats: FC<ReadOnlyStatsProps> = ({ status }) => {
  const actualStatus = getActualStatus(status)
  const totalShares = actualStatus.totalShares ?? 0
  const totalLikes = actualStatus.totalLikes ?? 0
  const boostsNoun = pluralNoun(totalShares, 'boost')
  const likesNoun = pluralNoun(totalLikes, 'like')
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
        title={`${totalShares} ${boostsNoun}`}
      >
        <Repeat2 className="size-4" aria-hidden="true" />
        <span className="tabular-nums">{totalShares}</span>
        <span className="sr-only">{boostsNoun}</span>
      </span>
      <span
        className="inline-flex items-center gap-1.5"
        title={`${totalLikes} ${likesNoun}`}
      >
        <Heart className="size-4" aria-hidden="true" />
        <span className="tabular-nums">{totalLikes}</span>
        <span className="sr-only">{likesNoun}</span>
      </span>
    </div>
  )
}
