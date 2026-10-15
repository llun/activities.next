import { Status } from '@/lib/types/domain/status'
import { getActorMentionPathSegment } from '@/lib/utils/getActorMentionPathSegment'
import { getActualStatus } from '@/lib/utils/text/processStatusText'

// Shared branch logic of the sync status-detail path. The hash is injected so
// server code can use node's crypto while browser-reachable code (notifications)
// uses the pure-JS twin, keeping node's crypto polyfills out of the bundle.
export const buildStatusDetailPath = (
  status: Status,
  getUrlHash: (url: string) => string
) => {
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

  return `/${getActorMentionPathSegment(actualStatus.actor)}/${getUrlHash(actualStatus.url)}`
}
