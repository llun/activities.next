import Image from 'next/image'
import Link from 'next/link'
import { FC } from 'react'

import { getNotificationStatusPath } from '@/app/(timeline)/notifications/getNotificationStatusPath'
import type { NotificationWithStatus } from '@/app/(timeline)/notifications/types'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { processStatusText } from '@/lib/utils/text/processStatusText'

interface Props {
  host: string
  notification: NotificationWithStatus
  // The verb phrase shown before the "post" link, e.g. "liked your",
  // "replied to your", "reblogged your", "mentioned you in a".
  action: string
}

export const StatusNotification: FC<Props> = ({
  host,
  notification,
  action
}) => {
  const { account, status, groupedCount } = notification

  const hasMultiple = groupedCount && groupedCount > 1
  const statusUrl = getNotificationStatusPath(status)

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
        {hasMultiple ? (
          <p className="text-sm">
            <Link
              href={`/@${account.acct}`}
              className="font-medium hover:underline"
            >
              {account.display_name || account.username}
            </Link>
            {groupedCount > 2 && ` and ${groupedCount - 1} others`}
            {groupedCount === 2 && ' and 1 other'} {action}{' '}
            <Link href={statusUrl} className="text-primary hover:underline">
              post
            </Link>
          </p>
        ) : (
          <p className="text-sm">
            <Link
              href={`/@${account.acct}`}
              className="font-medium hover:underline"
            >
              {account.display_name || account.username}
            </Link>{' '}
            {action}{' '}
            <Link href={statusUrl} className="text-primary hover:underline">
              post
            </Link>
          </p>
        )}
        <div className="mt-2 block rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          <div className="line-clamp-2 [&_p]:inline [&_br]:hidden">
            {cleanClassName(processStatusText(host, status))}
          </div>
        </div>
      </div>
    </div>
  )
}
