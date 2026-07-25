import { getBaseURL } from '@/lib/config'
import { EditableStatus } from '@/lib/types/domain/status'
import { getStatusDetailPath } from '@/lib/utils/getStatusDetailPath'

/**
 * Absolute URL of a status on the RECIPIENT's own server, so the link resolves
 * for them whether the post is local or remote.
 *
 * Replaces four near-identical private copies (one of which had drifted) that
 * each hardcoded `https://${config.host}` — wrong on an
 * `ACTIVITIES_INSECURE_AUTH=true` deployment. Built on `getStatusDetailPath` so
 * email links are byte-identical to the ones the web UI renders.
 *
 * Falls back to `status.url` when the status has no actor and no path can be
 * derived. That value is remote-controlled, so callers must pass it through the
 * layout's URL check rather than emitting it directly — `button` and
 * `fallbackUrl` already do.
 *
 * Takes `EditableStatus` rather than the wider `Status`: only a Note or a Poll
 * carries a `url`, and an Announce is never what a notification email quotes —
 * the call sites unwrap to the original status first.
 */
export const getEmailStatusUrl = (status: EditableStatus): string => {
  const path = getStatusDetailPath(status)
  return path ? `${getBaseURL()}${path}` : status.url
}

/** Absolute URL of an actor's profile on the recipient's own server. */
export const getEmailActorUrl = (handle: string): string =>
  `${getBaseURL()}/${handle}`
