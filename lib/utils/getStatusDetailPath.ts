import { getMention } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

export const getStatusDetailPath = (status: Status) => {
  const actualStatus = getActualStatus(status)
  if (!actualStatus.actor) return null

  return `/${getMention(actualStatus.actor, true)}/${encodeURIComponent(actualStatus.id)}`
}
