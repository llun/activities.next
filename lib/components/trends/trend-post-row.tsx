import { formatDistance } from 'date-fns'
import { Heart, Repeat2, Reply } from 'lucide-react'

import { safeExternalHref } from '@/lib/components/trends/safeHref'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import { htmlToPlainText } from '@/lib/utils/text/htmlToPlainText'

interface TrendPostRowProps {
  status: MastodonStatus
  currentTime: number
}

const getAccountLabel = (status: MastodonStatus) =>
  status.account.display_name ||
  status.account.username ||
  status.account.acct ||
  'Unknown'

const getAccountHandle = (status: MastodonStatus) => {
  const acct = status.account.acct || status.account.username || ''
  if (!acct) return ''
  return acct.startsWith('@') ? acct : `@${acct}`
}

const getAccountInitial = (status: MastodonStatus) => {
  const name = getAccountLabel(status).trim()
  return Array.from(name)[0]?.toUpperCase() ?? '?'
}

// A compact trending post: avatar + header + 2-line clamped body + the three
// engagement counts. Opens the status on its origin page.
export const TrendPostRow = ({ status, currentTime }: TrendPostRowProps) => {
  const label = getAccountLabel(status)
  const handle = getAccountHandle(status)
  const body = htmlToPlainText(status.content ?? '').trim()
  const timeAgo = formatDistance(new Date(status.created_at), currentTime, {
    addSuffix: true
  })

  return (
    <a
      href={safeExternalHref(status.url || status.uri)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted"
    >
      <Avatar className="size-10 shrink-0">
        {status.account.avatar && <AvatarImage src={status.account.avatar} />}
        <AvatarFallback>{getAccountInitial(status)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 text-sm">
          <span className="truncate font-semibold">{label}</span>
          <span className="truncate text-muted-foreground">{handle}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {timeAgo}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm leading-relaxed">{body}</p>
        <div className="mt-1.5 flex items-center gap-5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Reply className="size-3.5" />
            {status.replies_count}
          </span>
          <span className="flex items-center gap-1.5">
            <Repeat2 className="size-3.5" />
            {status.reblogs_count}
          </span>
          <span className="flex items-center gap-1.5">
            <Heart className="size-3.5" />
            {status.favourites_count}
          </span>
        </div>
      </div>
    </a>
  )
}
