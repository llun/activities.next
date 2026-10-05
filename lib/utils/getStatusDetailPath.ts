import { Status } from '@/lib/types/domain/status'
import { getActorMentionPathSegment } from '@/lib/utils/getActorMentionPathSegment'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

// Keep this in lockstep with getStatusDetailPathClient — the two are twins,
// split only because the hash fallback needs a sync vs an async digest.
export const getStatusDetailPath = (status: Status) => {
  const actualStatus = getActualStatus(status)
  if (!actualStatus.actor) return null

  // A publicId is the same short, opaque segment for local and remote statuses
  // alike, so it replaces BOTH legacy encodings below. The fallbacks stay for
  // statuses that have none: rows written before the backfill and
  // ActivityPub-derived objects that never carry one.
  if (actualStatus.publicId) {
    return `/${getActorMentionPathSegment(actualStatus.actor)}/${actualStatus.publicId}`
  }

  if (actualStatus.isLocalActor === false) {
    return `/${getActorMentionPathSegment(actualStatus.actor)}/${encodeURIComponent(actualStatus.id)}`
  }

  return `/${getActorMentionPathSegment(actualStatus.actor)}/${getHashFromString(actualStatus.url)}`
}
