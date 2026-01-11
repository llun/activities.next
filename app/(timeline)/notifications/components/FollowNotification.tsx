import { Mastodon } from '@llun/activities.schema'
import Image from 'next/image'
import Link from 'next/link'
import { FC } from 'react'

import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'

interface NotificationWithAccount extends GroupedNotification {
  account: Mastodon.Account
  groupedAccounts?: (Mastodon.Account | null)[] | null
}

interface Props {
  notification: NotificationWithAccount
}

export const FollowNotification: FC<Props> = ({ notification }) => {
  const { account, groupedAccounts, groupedCount } = notification
  const hasMultiple = groupedCount && groupedCount > 1

  return (
    <div className="flex items-center gap-4">
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
            {groupedCount === 2 && ' and 1 other'} started following you
          </p>
        ) : (
          <p className="text-sm">
            <Link
              href={`/@${account.acct}`}
              className="font-medium hover:underline"
            >
              {account.display_name || account.username}
            </Link>{' '}
            started following you
          </p>
        )}
        <p className="text-xs text-muted-foreground">@{account.acct}</p>
      </div>
    </div>
  )
}
