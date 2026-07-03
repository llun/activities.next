import { FC } from 'react'

import type { NotificationType } from '@/lib/types/database/operations'
import { cn } from '@/lib/utils'

import { NOTIFICATION_TYPE_CONFIG } from '../notificationConfig'

interface Props {
  type: NotificationType
}

// The per-type glyph badge that leads every notification row. Decorative — the
// row text already names the notification — so it is hidden from assistive tech.
export const NotificationTypeBadge: FC<Props> = ({ type }) => {
  const cfg = NOTIFICATION_TYPE_CONFIG[type] as
    (typeof NOTIFICATION_TYPE_CONFIG)[NotificationType] | undefined
  // Defensive: render nothing for an unrecognized type rather than throwing,
  // even though callers only mount this for configured types.
  if (!cfg) return null
  const Icon = cfg.icon

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full',
        cfg.badgeClassName
      )}
    >
      <Icon size={15} {...(cfg.iconFilled ? { fill: 'currentColor' } : {})} />
    </span>
  )
}
