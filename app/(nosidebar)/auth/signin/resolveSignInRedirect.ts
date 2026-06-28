import { buildOAuthAuthorizePath } from '@/app/(nosidebar)/oauth/authorize/authorizeQuery'
import type { SearchParams } from '@/app/(nosidebar)/oauth/authorize/types'
import { isSafeInternalPath } from '@/lib/utils/isSafeInternalPath'

// The OAuth/OIDC authorization-request params better-auth forwards in its
// loginPage redirect. Deliberately excludes the signed envelope (sig/exp and
// better-auth's internal ba_iat/ba_param) so it is dropped on resume — see below.
const OIDC_REQUEST_PARAM_KEYS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'request_uri',
  'code_challenge',
  'code_challenge_method',
  'nonce',
  'prompt'
] as const

/**
 * Decides where the sign-in forms navigate after a successful login.
 *
 * better-auth advertises its own `/api/auth/oauth2/authorize` as the OIDC
 * `authorization_endpoint`, so a relying party (e.g. la-suite Docs) sends a
 * logged-out user straight there — bypassing the custom `/oauth/authorize` page,
 * the only place that sets a `redirectBack`. better-auth then redirects here
 * with the signed OAuth query but NO `redirectBack`. Without resuming, the forms
 * would push to `/` and silently drop the OIDC request. So:
 *
 *   1. honour a safe `redirectBack` (e.g. the custom consent page's own handoff),
 *   2. else, if the URL carries an OIDC authorization request, resume it by
 *      returning the consent page path with the bare OAuth params — `sig`/`exp`
 *      are dropped on purpose so the consent page's `shouldDelegateToBetterAuth`
 *      returns true and re-delegates to better-auth (now authenticated) for a
 *      fresh consent signature; this is robust to a slow login whose 10-minute
 *      login signature has expired,
 *   3. else fall back to `/`.
 *
 * Only ever returns an internal path. `redirect_uri` is carried as an opaque
 * query value and is validated downstream by the consent page (against the
 * client's registered URIs) and better-auth — it is never the navigation target.
 */
export const resolveSignInRedirect = (
  searchParams: Pick<URLSearchParams, 'get'>
): string => {
  const redirectBack = searchParams.get('redirectBack')
  if (redirectBack && isSafeInternalPath(redirectBack)) {
    return redirectBack
  }

  if (
    searchParams.get('response_type') === 'code' &&
    searchParams.get('client_id')
  ) {
    // Built by loop so only params actually present are forwarded (an explicit
    // object would emit empty `state=`/`nonce=` keys). buildOAuthQuery treats
    // its input as a string record; the cast is needed only because SearchParams
    // types `response_type` as the literal 'code'.
    const oidcRequest: Record<string, string> = {}
    for (const key of OIDC_REQUEST_PARAM_KEYS) {
      const value = searchParams.get(key)
      if (value != null) oidcRequest[key] = value
    }
    return buildOAuthAuthorizePath(oidcRequest as unknown as SearchParams)
  }

  return '/'
}
