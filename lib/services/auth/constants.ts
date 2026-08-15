// The basePath the better-auth instance is mounted at. better-auth joins it onto
// the configured baseURL to form `ctx.context.baseURL`
// (e.g. `https://llun.social/api/auth`), which is the value it stamps as the OIDC
// id_token `iss`, the value the RP-Initiated Logout endpoint enforces
// (`id_token.iss === jwt.issuer ?? ctx.context.baseURL`), and the prefix every
// `/api/auth/...` endpoint is served under.
//
// This is shared by the two places that must agree on it: `auth.ts` passes it as
// better-auth's `basePath`, and the hand-written OpenID discovery document
// (lib/services/wellknown/openidConfiguration.ts) builds its `issuer`/endpoints
// from it — so the advertised issuer can never drift from the basePath the tokens
// are actually signed under. (Note: the OAuth proxy routes under `app/api/oauth/*`
// still spell `/api/auth/...` literally; migrating those is out of scope here.)
export const AUTH_BASE_PATH = '/api/auth'

// The in-app page better-auth redirects a failed auth/OAuth request to
// (`onAPIError.errorURL` in `auth.ts`, rendered by
// `app/(nosidebar)/auth/error/page.tsx`).
//
// Deliberately a ROOT-RELATIVE path, not an absolute URL. better-auth copies
// this value straight into the `Location` header (`ctx.redirect` /
// `formatErrorURL` do no resolution), so a relative path keeps the visitor on
// the host the request actually arrived on — the same reason `/oauth/authorize`
// builds its sign-in redirects from the request host. An absolute URL built
// from `getBaseURL()` would bounce a login started on a trusted alias domain
// over to ACTIVITIES_HOST mid-flow.
//
// Without this, better-auth falls back to its own `/api/auth/error` page, which
// in production does not render at all: it 302s to `/?error=...`, dropping the
// visitor on the home timeline so a failed sign-in looks like it silently did
// nothing.
export const AUTH_ERROR_PATH = '/auth/error'
