import { Status } from '@/lib/types/domain/status'
import { buildStatusDetailPath } from '@/lib/utils/buildStatusDetailPath'
import { getHashFromStringClient } from '@/lib/utils/getHashFromStringClient'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

// Async twin of getStatusDetailPath that digests with WebCrypto. The branches
// live in buildStatusDetailPath; the url digest is awaited up front, and only
// when the url fallback branch can be reached.
export const getStatusDetailPathClient = async (status: Status) => {
  const actualStatus = getActualStatus(status)
  const needsUrlHash =
    Boolean(actualStatus.actor) &&
    !actualStatus.publicId &&
    actualStatus.isLocalActor !== false
  const urlHash = needsUrlHash
    ? await getHashFromStringClient(actualStatus.url)
    : ''
  return buildStatusDetailPath(status, () => urlHash)
}
