import Image from 'next/image'
import Link from 'next/link'
import { FC } from 'react'

import { GroupedNotification } from '@/lib/services/notifications/groupNotifications'
import { Mastodon } from '@/lib/types/activitypub'
import { getMention } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'
import { cleanClassName } from '@/lib/utils/text/cleanClassName'
import { processStatusText } from '@/lib/utils/text/processStatusText'

type StatusWithActor = Status & { actor: NonNullable<Status['actor']> }

interface NotificationWithData extends GroupedNotification {
  account: Mastodon.Account
  status: StatusWithActor
}

interface Props {
  host: string
  notification: NotificationWithData
}

export const ActivityImportNotification: FC<Props> = ({
  host,
  notification
}) => {
  const { account, status } = notification

  const hasMultiple = notification.groupedCount && notification.groupedCount > 1
  // activity_import is currently emitted only by the Strava importer.
  const serviceLabel = 'Strava'

  const statusUrl =
    getStatusDetailPath(status) ??
    `/${getMention(status.actor, true)}/${encodeURIComponent(status.id)}`

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
        <p className="text-sm">
          {hasMultiple
            ? `Your ${serviceLabel} fitness activities were imported.`
            : `Your ${serviceLabel} fitness activity was imported.`}{' '}
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
    </div>
  )
}
