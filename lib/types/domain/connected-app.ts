import { z } from 'zod'

// A third-party OAuth grant the account has authorized — either an API client
// (Mastodon app such as Ice Cubes/Elk, granted read/write/follow/push) or an
// SSO "sign-in" connection (an external site that uses this account to log you
// in, e.g. read:accounts + openid). Grounded in the better-auth `oauthConsent`
// record joined with the registered `oauthClient`. Scopes are kept as raw
// strings (not the strict Scope enum) so an unexpected granted scope is shown
// rather than dropped.
export const ConnectedApp = z.object({
  // The registered OAuth client id this grant belongs to.
  clientId: z.string(),
  // The actor (referenceId) the grant was made for; an account can authorize
  // the same app under more than one actor. Null when the grant is not
  // actor-scoped.
  actorId: z.string().nullable(),
  // Display name / website of the registered client, when known.
  name: z.string().nullable(),
  website: z.string().nullable(),
  // The scopes the user consented to, in their stored order.
  scopes: z.string().array(),
  // When the grant was first authorized (ms epoch).
  authorizedAt: z.number(),
  // True when this is an OpenID Connect sign-in (SSO) grant rather than an API
  // client — surfaced as a distinct "Sign-in" connection in the UI.
  signIn: z.boolean()
})
export type ConnectedApp = z.infer<typeof ConnectedApp>
