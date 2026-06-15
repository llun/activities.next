import { Activity } from 'lucide-react'
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

// The body of an activity-import (system) notification: an inline fitness card
// with the imported activity and a link straight to the workout. The bold
// "Your fitness activity is ready" headline lives in NotificationItem.
export const ActivityImportNotification: FC<Props> = ({
  host,
  notification
}) => {
  const { status, groupedCount } = notification
  const hasMultiple = (groupedCount ?? 0) > 1
  const statusUrl = getNotificationStatusPath(status)

  return (
    <div className="mt-2 flex items-center gap-3 rounded-xl border bg-background p-2.5">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
      >
        <Activity className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1 line-clamp-2 text-[13px] leading-snug text-foreground [&_br]:hidden [&_p]:inline">
        {cleanClassName(processStatusText(host, status))}
      </div>
      <Link
        href={statusUrl}
        className="shrink-0 text-[13px] font-medium text-primary hover:underline"
      >
        {hasMultiple ? 'View latest activity' : 'View activity'}
      </Link>
    </div>
  )
}
