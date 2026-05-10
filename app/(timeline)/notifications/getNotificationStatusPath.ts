import type { StatusWithActor } from '@/app/(timeline)/notifications/types'
import { getMention } from '@/lib/types/domain/actor'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'

export const getNotificationStatusPath = (status: StatusWithActor) =>
  getStatusDetailPath(status) ??
  `/${getMention(status.actor, true)}/${encodeURIComponent(status.id)}`
