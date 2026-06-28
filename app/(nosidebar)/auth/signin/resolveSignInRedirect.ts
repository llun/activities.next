import { buildOAuthAuthorizePath } from '@/app/(nosidebar)/oauth/authorize/authorizeQuery'
import type { SearchParams } from '@/app/(nosidebar)/oauth/authorize/types'
import { isSafeInternalPath } from '@/lib/utils/isSafeInternalPath'

// better-auth's loginPage redirect wraps the OAuth query in a signed envelope:
// `sig`/`exp` (the signature and its expiry) plus `ba_*` internals (ba_iat,
// ba_param, ba_pl). Those — and our own `redirectBack` — must NOT be forwarded
// when resuming the request; everything else (the relying party's full OIDC
// request: response_type, client_id, redirect_uri, scope, state, PKCE, nonce,
// prompt, and any other standard param like response_mode/login_hint/max_age)
// is preserved.
const isBetterAuthEnvelopeKey = (key: string): boolean =>
  key === 'redirectBack' ||
  key === 'sig' ||
  key === 'exp' ||
  key.startsWith('ba_')

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
 *      returning the consent page path with the request's params (minus the
 *      better-auth envelope) — `sig`/`exp` are dropped on purpose so the consent
 *      page's `shouldDelegateToBetterAuth` returns true and re-delegates to
 *      better-auth (now authenticated) for a fresh consent signature; this is
 *      robust to a slow login whose 10-minute login signature has expired,
 *   3. else fall back to `/`.
 *
 * Only ever returns an internal path (see `isSafeInternalPath`). `redirect_uri`
 * is carried as an opaque query value and validated downstream by the consent
 * page (against the client's registered URIs) and better-auth — never the
 * navigation target.
 */
export const resolveSignInRedirect = (
  searchParams: Pick<URLSearchParams, 'get' | 'forEach'>
): string => {
  const redirectBack = searchParams.get('redirectBack')
  if (redirectBack && isSafeInternalPath(redirectBack)) {
    return redirectBack
  }

  if (
    searchParams.get('response_type') === 'code' &&
    searchParams.get('client_id')
  ) {
    const oidcRequest: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      if (!isBetterAuthEnvelopeKey(key)) oidcRequest[key] = value
    })

    // The interactive login better-auth's `prompt=login`/`create` demanded has
    // just happened, so strip those tokens — leaving them would make
    // better-auth's GET authorize bounce the now-authenticated user back to
    // /auth/signin -> '/', re-dropping the request. `consent` (and any other
    // tokens) are preserved; the param is removed entirely if nothing is left.
    if (oidcRequest.prompt) {
      const prompts = oidcRequest.prompt
        .split(' ')
        .filter((token) => token && token !== 'login' && token !== 'create')
      if (prompts.length > 0) oidcRequest.prompt = prompts.join(' ')
      else delete oidcRequest.prompt
    }

    // buildOAuthQuery treats its input as a string record; the cast is needed
    // only because SearchParams types `response_type` as the literal 'code'.
    return buildOAuthAuthorizePath(oidcRequest as unknown as SearchParams)
  }

  return '/'
}
