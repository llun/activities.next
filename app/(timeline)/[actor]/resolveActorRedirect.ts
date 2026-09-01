import type { Database } from '@/lib/database/types'
import { isLocalFederationDomain } from '@/lib/services/federation/domainPolicy'

/**
 * Given an already-parsed `username`/`domain` pulled out of an `@user@domain`
 * actor handle, returns the actor's canonical remote profile URL under
 * `subpath` (e.g. '', '/followers', '/following') when `domain` is one this
 * instance does NOT federate locally — the URL a visitor should be pointed at
 * instead of resolving the actor from this instance's own database. Returns
 * null when the domain IS local, i.e. there is nothing to redirect to.
 *
 * This is a PURE locality check: it never decides whether a caller should
 * actually redirect. The three `[actor]` pages that call it disagree on WHEN
 * a redirect should fire, so each applies its own gate around this helper's
 * result rather than the helper deciding for them — do not fold either gate
 * into this function:
 *
 *   - `[actor]/page.tsx` additionally gates on `!isLoggedIn`. A signed-in
 *     visitor who follows a remote actor's canonical `/@user@domain` link
 *     still gets a chance to resolve the actor from this instance first (so
 *     their own relationship/follow state renders), so its page body only
 *     calls this helper AFTER `getProfileData` has already failed to resolve
 *     the actor locally, and only redirects when the visitor is also logged
 *     out.
 *   - `[actor]/followers/page.tsx` and `[actor]/following/page.tsx` redirect
 *     ANY visitor — logged in or not — and decide up front, before
 *     attempting to resolve the actor at all. Those sub-pages carry no
 *     viewer-specific state worth preserving, so there is nothing to gain by
 *     resolving a remote actor's follow lists locally first.
 */
export const getNonLocalActorRedirectTarget = async (
  database: Database,
  username: string,
  domain: string,
  subpath: string
): Promise<string | null> => {
  const isLocal = await isLocalFederationDomain(database, domain)
  if (isLocal) return null
  return `https://${domain}/@${username}${subpath}`
}
