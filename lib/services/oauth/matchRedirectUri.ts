// isLoopbackIP is a PUBLIC export of @better-auth/core (its `exports` map
// declares `./utils/*`), which is a direct, exact-pinned dependency — the same
// reasoning that lets `app/api/v1/apps/createApplication.ts` import
// `SafeUrlSchema` from `@better-auth/core/utils/redirect-uri`.
import { isLoopbackIP } from '@better-auth/core/utils/host'

// Does a requested redirect_uri match one the client registered?
//
// This deliberately reproduces the rule Better Auth's authorize endpoint
// applies (`@better-auth/oauth-provider`): an exact string match, OR — when the
// REGISTERED host is a loopback IP — a match on protocol + hostname + pathname
// + search that IGNORES THE PORT. RFC 8252 §7.3 requires that: a native app
// binds an ephemeral loopback port at run time and cannot know it when it
// registers, so `http://127.0.0.1:8080/callback` must also accept
// `http://127.0.0.1:51234/callback`.
//
// `/oauth/authorize` validates the request before delegating to Better Auth, so
// it MUST use the same rule. A stricter check there 404s a client Better Auth
// would have happily authorized (this regressed loopback native clients once
// already); a looser one would let an unregistered URI reach the delegate.
// Keep the two in lockstep — if Better Auth's matcher changes, change this.
//
// Note `isLoopbackIP` covers 127.0.0.0/8 and ::1 but NOT the name `localhost`,
// so a client that registers `http://localhost:8080/…` gets exact matching
// only. That is Better Auth's behaviour, and matching it is the point.
export const matchesRegisteredRedirectUri = (
  registeredUris: string[],
  requestedUri: string
): boolean => {
  // Guard the empty string: `redirect_uri` is a required query param, but
  // `z.string()` accepts '', and Better Auth rejects a blank redirect_uri too.
  if (!requestedUri) return false

  return registeredUris.some((registeredUri) => {
    if (registeredUri === requestedUri) return true

    try {
      const registered = new URL(registeredUri)
      const requested = new URL(requestedUri)
      return (
        isLoopbackIP(registered.hostname) &&
        registered.hostname === requested.hostname &&
        registered.pathname === requested.pathname &&
        registered.protocol === requested.protocol &&
        registered.search === requested.search
      )
    } catch {
      return false
    }
  })
}
