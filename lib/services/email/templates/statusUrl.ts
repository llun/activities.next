import { getBaseURL } from '@/lib/config'
import { Status } from '@/lib/types/domain/status'
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
 */
export const getEmailStatusUrl = (status: Status): string => {
  const path = getStatusDetailPath(status)
  return path ? `${getBaseURL()}${path}` : status.url
}

/** Absolute URL of an actor's profile on the recipient's own server. */
export const getEmailActorUrl = (handle: string): string =>
  `${getBaseURL()}/${handle}`
