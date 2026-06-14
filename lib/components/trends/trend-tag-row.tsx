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
// Links to the hashtag timeline, matching the rest of the app.
export const TrendTagRow = ({ tag, compact = false }: TrendTagRowProps) => {
  const history = getTagUsesHistory(tag)
  const people = getTagPeoplePast2Days(tag)

  return (
    <Link
      href={`/tags/${encodeURIComponent(tag.name)}`}
      className="flex items-center justify-between gap-4 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted"
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
        width={compact ? 52 : 62}
        height={compact ? 24 : 27}
      />
    </Link>
  )
}
