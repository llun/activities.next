'use client'

import { formatDistance } from 'date-fns/formatDistance'
import { Quote } from 'lucide-react'
import Link from 'next/link'
import { FC, useEffect, useState } from 'react'

import { getStatusById } from '@/lib/client'
import { SkeletonBar } from '@/lib/components/surface/Skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { QuoteState, StatusQuote } from '@/lib/types/domain/status'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import { cn } from '@/lib/utils'
import { getMastodonStatusDetailPath } from '@/lib/utils/getMastodonStatusDetailPath'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

interface Props {
  quote: StatusQuote
  // Epoch ms from the server (hydration rule: never Date.now() in client render).
  currentTime: number
  className?: string
}

// Non-accepted edges never embed content; render a state-specific tombstone.
const TOMBSTONE_TEXT: Record<Exclude<QuoteState, 'accepted'>, string> = {
  pending: 'Quote pending approval',
  rejected: 'This quote was declined',
  revoked: 'This quote was withdrawn',
  deleted: 'The quoted post is no longer available'
}

const Tombstone: FC<{ text: string; className?: string }> = ({
  text,
  className
}) => (
  <div
    className={cn(
      'mt-2 flex items-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground italic',
      className
    )}
  >
    <Quote className="size-4 shrink-0" />
    <span>{text}</span>
  </div>
)

// Embedded card for a quoted post. For an `accepted` edge it lazily fetches the
// quoted status (the API 404s when the viewer may not see it, so unreadable
// quotes fall back to the unavailable tombstone rather than leaking content).
// Depth is bounded at 1: the fetched quoted status is rendered as a compact
// plain-text preview, never with its own nested quote card.
export const QuoteCard: FC<Props> = ({ quote, currentTime, className }) => {
  const [quotedStatus, setQuotedStatus] = useState<MastodonStatus | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (quote.state !== 'accepted') return
    let active = true
    setLoaded(false)
    getStatusById(quote.quotedStatusId)
      .then((status) => {
        if (!active) return
        setQuotedStatus(status)
        setLoaded(true)
      })
      .catch(() => {
        // A rejected fetch (offline, aborted, bad body) falls back to the
        // unavailable tombstone instead of sticking on the loading state.
        if (!active) return
        setQuotedStatus(null)
        setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [quote.state, quote.quotedStatusId])

  if (quote.state !== 'accepted') {
    return (
      <Tombstone text={TOMBSTONE_TEXT[quote.state]} className={className} />
    )
  }

  if (!loaded) {
    return (
      // Not a live region: a feed can hold several quote cards, and each
      // announcing itself would break "one status per screen".
      <div
        className={cn(
          'mt-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-3',
          className
        )}
        aria-busy="true"
      >
        <span className="sr-only">Loading quoted post</span>
        <SkeletonBar className="h-4 w-2/3" />
      </div>
    )
  }

  if (!quotedStatus) {
    return (
      <Tombstone text="This quoted post is unavailable" className={className} />
    )
  }

  const account = quotedStatus.account
  const preview = htmlToPlainText(quotedStatus.content)
  const relativeTime = formatDistance(
    new Date(quotedStatus.created_at),
    currentTime
  )

  const serviceUrl = getMastodonStatusDetailPath(
    quotedStatus,
    quote.quotedStatusId
  )

  return (
    <Link
      href={serviceUrl}
      prefetch={false}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'mt-2 block overflow-hidden rounded-xl border border-border/60 border-l-4 border-l-primary/40 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/40',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Avatar className="size-5 shrink-0">
          <AvatarImage src={account.avatar} alt="" />
          <AvatarFallback>
            {(account.display_name || account.username || '?')
              .charAt(0)
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="shrink-0 max-w-full truncate font-medium text-foreground">
          {account.display_name || account.username}
        </span>
        <span className="min-w-0 flex-1 truncate">@{account.acct}</span>
        <span aria-hidden className="shrink-0">
          ·
        </span>
        <span className="shrink-0">{relativeTime}</span>
      </div>
      <div className="mt-1 line-clamp-3 text-sm text-foreground/90 break-words">
        {preview || (
          <span className="italic text-muted-foreground">
            No content preview
          </span>
        )}
      </div>
    </Link>
  )
}
