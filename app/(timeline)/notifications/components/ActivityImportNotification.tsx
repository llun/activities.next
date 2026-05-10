import Link from 'next/link'
import { FC } from 'react'

import { getNotificationStatusPath } from '@/app/(timeline)/notifications/getNotificationStatusPath'
import type { NotificationWithStatus } from '@/app/(timeline)/notifications/types'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { processStatusText } from '@/lib/utils/text/processStatusText'

interface Props {
  host: string
  notification: NotificationWithStatus
}

export const ActivityImportNotification: FC<Props> = ({
  host,
  notification
}) => {
  const { status } = notification

  const hasMultiple = notification.groupedCount && notification.groupedCount > 1
  const statusUrl = getNotificationStatusPath(status)

  return (
    <div className="min-w-0">
      <p className="text-sm">
        {hasMultiple
          ? 'Your fitness activities were imported.'
          : 'Your fitness activity was imported.'}{' '}
        <Link href={statusUrl} className="text-primary hover:underline">
          {hasMultiple ? 'View latest activity' : 'View activity'}
        </Link>
      </p>
      <div className="mt-2 block rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
        <div className="line-clamp-2 [&_p]:inline [&_br]:hidden">
          {cleanClassName(processStatusText(host, status))}
        </div>
      </div>
    </div>
  )
}
