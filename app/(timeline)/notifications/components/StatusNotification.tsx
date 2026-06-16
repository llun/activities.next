import Link from 'next/link'
import { FC } from 'react'

import type { NotificationWithStatus } from '@/app/(timeline)/notifications/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/lib/components/ui/avatar'
import { cn } from '@/lib/utils'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { processStatusText } from '@/lib/utils/text/processStatusText'

import { getGroupedName, getInitials } from '../notificationConfig'

interface Props {
  host: string
  notification: NotificationWithStatus
  // mention/reply quote the subject post in full-contrast text; like/reblog mute
  // it so the quoted post reads as context rather than a new post.
  emphasizePreview: boolean
}

// The body of a post-linking (status) notification: the actor avatar + name on
// their own line, then the quoted subject post. The leading verb ("liked your
// post", …) and the whole-row link to the post live in NotificationItem.
export const StatusNotification: FC<Props> = ({
  host,
  notification,
  emphasizePreview
}) => {
  const { account, status, groupedCount } = notification
  const name = account.display_name || account.username
  const groupedName = getGroupedName(name, groupedCount)

  return (
    <>
      <div className="mt-1.5 flex items-center gap-2">
        <Avatar className="size-6">
          {account.avatar && (
            <AvatarImage
              src={account.avatar}
              alt={name}
              className="object-cover"
            />
          )}
          <AvatarFallback className="text-[10px] font-semibold">
            {getInitials(name)}
          </AvatarFallback>
        </Avatar>
        <Link
          href={`/@${account.acct}`}
          className="truncate text-[13px] font-semibold hover:underline"
        >
          {groupedName}
        </Link>
      </div>
      <div
        className={cn(
          'mt-1 line-clamp-2 text-[13px] leading-relaxed [&_br]:hidden [&_p]:inline',
          emphasizePreview ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {cleanClassName(processStatusText(host, status))}
      </div>
    </>
  )
}
