import { getMention } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { getHashFromStringClient } from '@/lib/utils/getHashFromStringClient'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

export const getStatusDetailPathClient = async (status: Status) => {
  const actualStatus = getActualStatus(status)
  if (!actualStatus.actor) return null

  const urlHash = await getHashFromStringClient(actualStatus.url)
  return `/${getMention(actualStatus.actor, true)}/${urlHash}`
}
