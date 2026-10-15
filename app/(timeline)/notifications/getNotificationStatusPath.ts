import type { StatusWithActor } from '@/app/(timeline)/notifications/types'
import { getMention } from '@/lib/types/domain/actor'
import { getStatusDetailPathSync } from '@/lib/utils/getStatusDetailPathSync'

export const getNotificationStatusPath = (status: StatusWithActor) =>
  getStatusDetailPathSync(status) ??
  `/${getMention(status.actor, true)}/${encodeURIComponent(status.id)}`
