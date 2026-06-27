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
