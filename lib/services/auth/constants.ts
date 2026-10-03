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

// How long an access token issued for a user lives from its last slide: the
// bearer guards move `expiresAt` to now + this window when they accept a
// request (see `extendAccessTokenIfDue` in `OAuthGuard`), writing at most once
// per OAUTH_ACCESS_TOKEN_SLIDE_INTERVAL_SECONDS. A token therefore lasts as long
// as its client keeps using it, and lapses between this window minus one slide
// interval (6 days) and this window (7 days) after its last accepted request.
//
// The sliding half is what keeps Mastodon clients signed in. This server cannot
// issue a refresh token at all — better-auth only mints one for the
// `offline_access` scope, which is not in this server's scope vocabulary — and
// Mastodon clients would not use one anyway: Mastodon's access tokens never
// expire, so Ivory, Ice Cubes, Tusky, Phanpy, Elk and the rest store the token
// once. Without the slide every one of them was signed out on the seventh day
// after authorizing, however active it was: the first request after
// `expiresAt` 401s (`token_expired` in `OAuthGuard`) and the client reads that
// as "this account is gone". With releases going out several times a day it
// looked as though each deploy logged the apps out.
//
// Shared by `auth.ts` (better-auth's `accessTokenExpiresIn`), `issueAccessToken`
// (tokens minted directly for an account registered over the API) and the slide
// in `OAuthGuard`, so all three agree on the window.
export const OAUTH_ACCESS_TOKEN_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60

// How often `OAuthGuard` writes a slide: only once a token has been used this
// long after it was issued or last extended, so a busy client costs one UPDATE
// a day rather than one per request.
export const OAUTH_ACCESS_TOKEN_SLIDE_INTERVAL_SECONDS = 24 * 60 * 60
