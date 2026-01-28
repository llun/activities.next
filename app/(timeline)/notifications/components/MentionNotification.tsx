import Image from 'next/image'
import Link from 'next/link'
import { FC } from 'react'

import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import { Mastodon } from '@/lib/types/activitypub'
import { getMention } from '@/lib/types/domain/actor'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'

interface NotificationWithData extends GroupedNotification {
  account: Mastodon.Account
  status: Status
  groupedAccounts?: (Mastodon.Account | null)[] | null
}

interface Props {
  notification: NotificationWithData
}

export const MentionNotification: FC<Props> = ({ notification }) => {
  const { account, status, groupedAccounts, groupedCount } = notification
  if (!status.actor) return null

  const displayStatus =
    status.type === StatusType.enum.Announce ? status.originalStatus : status
  const hasMultiple = groupedCount && groupedCount > 1

  const statusUrl = `/${getMention(status.actor, true)}/${status.id.split('/').pop()}`

  return (
    <div className="flex items-start gap-4">
      <div className="relative size-12 shrink-0">
        {account.avatar && (
          <Image
            src={account.avatar}
            alt={account.display_name || account.username}
            fill
            className="rounded-full object-cover"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        {hasMultiple && groupedAccounts ? (
          <p className="text-sm">
            <Link
              href={`/@${account.acct}`}
              className="font-medium hover:underline"
            >
              {account.display_name || account.username}
            </Link>
            {groupedCount > 2 && ` and ${groupedCount - 1} others`}
            {groupedCount === 2 && ' and 1 other'} mentioned you
          </p>
        ) : (
          <p className="text-sm">
            <Link
              href={`/@${account.acct}`}
              className="font-medium hover:underline"
            >
              {account.display_name || account.username}
            </Link>{' '}
            mentioned you
          </p>
        )}
        <Link
          href={statusUrl}
          className="mt-2 block rounded-md bg-muted/50 p-2 text-xs text-muted-foreground hover:bg-muted"
        >
          <p className="line-clamp-2">{(displayStatus as StatusNote).text}</p>
        </Link>
      </div>
    </div>
  )
}
