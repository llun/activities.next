import Link from 'next/link'

import { PeopleLine } from '@/lib/components/trends/people-line'
import { Sparkline } from '@/lib/components/trends/sparkline'
import {
  getTagPeoplePast2Days,
  getTagUsesHistory
} from '@/lib/components/trends/tagTrend'
import type { Tag } from '@/lib/types/mastodon/tag'
import { cn } from '@/lib/utils'

interface TrendTagRowProps {
  tag: Tag
  // Compact rows tighten the type scale and sparkline for embedded blocks
  // (e.g. the "Trending now" block on Search).
  compact?: boolean
}

// One trending hashtag — name, "{n} people" line, and a 7-day usage sparkline.
// Links to the hashtag timeline, matching the rest of the app. It is one row
// of a `FramedList`: the caller wraps it in a `FramedListItem` without padding
// (`className="p-0"`), so the whole row is the link's hover target.
export const TrendTagRow = ({ tag, compact = false }: TrendTagRowProps) => {
  const history = getTagUsesHistory(tag)
  const people = getTagPeoplePast2Days(tag)

  return (
    <Link
      href={`/tags/${encodeURIComponent(tag.name)}`}
      prefetch={false}
      className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:ring-inset outline-none"
    >
      <div className="min-w-0">
        <div
          className={cn(
            'truncate font-semibold',
            compact ? 'text-sm' : 'text-[15px]'
          )}
        >
          #{tag.name}
        </div>
        <PeopleLine people={people} />
      </div>
      <Sparkline
        values={history}
        width={compact ? 52 : 60}
        height={compact ? 24 : 22}
      />
    </Link>
  )
}
