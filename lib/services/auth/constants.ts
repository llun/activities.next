// The better-auth mount path. This is the single source of truth for the auth
// basePath: better-auth joins it onto the configured baseURL to form
// `ctx.context.baseURL` (e.g. `https://llun.social/api/auth`), which is the
// value it stamps as the OIDC id_token `iss`, the value the RP-Initiated Logout
// endpoint enforces (`id_token.iss === jwt.issuer ?? ctx.context.baseURL`), and
// the prefix every `/api/auth/...` endpoint is served under. The hand-written
// OpenID discovery document (lib/services/wellknown/openidConfiguration.ts)
// builds its `issuer`/endpoints from the same constant so the advertised issuer
// can never drift from the basePath the tokens are actually signed with.
export const AUTH_BASE_PATH = '/api/auth'
