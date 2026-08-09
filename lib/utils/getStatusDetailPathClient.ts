import { getMention } from '@/lib/types/domain/actor'
import { Status } from '@/lib/types/domain/status'
import { getHashFromStringClient } from '@/lib/utils/getHashFromStringClient'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

// Client twin of getStatusDetailPath — keep the branches identical; only the
// hash fallback differs (WebCrypto digest, hence async).
export const getStatusDetailPathClient = async (status: Status) => {
  const actualStatus = getActualStatus(status)
  if (!actualStatus.actor) return null

  // A publicId is the same short, opaque segment for local and remote statuses
  // alike, so it replaces BOTH legacy encodings below. The fallbacks stay for
  // statuses that have none: rows written before the backfill and
  // ActivityPub-derived objects that never carry one.
  if (actualStatus.publicId) {
    return `/${getMention(actualStatus.actor, true)}/${actualStatus.publicId}`
  }

  if (actualStatus.isLocalActor === false) {
    return `/${getMention(actualStatus.actor, true)}/${encodeURIComponent(actualStatus.id)}`
  }

  const urlHash = await getHashFromStringClient(actualStatus.url)
  return `/${getMention(actualStatus.actor, true)}/${urlHash}`
}
