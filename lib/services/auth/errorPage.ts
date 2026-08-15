// Copy and input handling for the in-app auth error page
// (`app/(nosidebar)/auth/error/page.tsx`), which better-auth redirects to via
// `onAPIError.errorURL`. Kept dependency-free so both the page and its tests can
// import it without pulling in the auth instance.

export interface AuthErrorContent {
  /** Card title — what went wrong, in the visitor's terms. */
  title: string
  /** Supporting copy: what it means and what to do next. */
  body: string
}

export const AUTH_ERROR_FALLBACK: AuthErrorContent = {
  title: "We couldn't complete that sign-in",
  body: 'Something went wrong while signing you in. Try again, and if it keeps happening contact the administrator of this instance.'
}

// Only the codes this instance can actually emit. better-auth's full error list
// is much longer, but most of it belongs to flows this deployment does not run:
// there are no `socialProviders`, no `sso()` and no `genericOAuth()`, so the
// provider-callback codes (`state_mismatch`, `account_not_linked`,
// `unable_to_get_user_info`, …) are unreachable here. Anything unmapped —
// including a code invented by someone hand-crafting a link to this page —
// falls back to AUTH_ERROR_FALLBACK rather than being echoed as prose.
const AUTH_ERROR_CONTENT: Record<string, AuthErrorContent> = {
  // @better-auth/oauth-provider: unknown, unregistered or disabled client.
  // `invalid_client` doubles as "client_id is missing", hence the joint copy.
  invalid_client: {
    title: "This app isn't registered here",
    body: "The app that sent you here isn't registered with this instance, or its registration was removed. Sign out of it and connect it again to register it afresh."
  },
  client_disabled: {
    title: 'This app has been disabled',
    body: 'The administrator of this instance disabled the app that sent you here. Contact them if you think that is a mistake.'
  },
  unauthorized_client: {
    title: "This app can't sign you in",
    body: "The app that sent you here isn't allowed to use this sign-in method on this instance. Contact its developer, or the administrator of this instance."
  },
  // Reported here rather than to the client per RFC 6749 §4.1.2.1: an
  // unregistered redirect_uri must never be redirected to.
  invalid_redirect: {
    title: "This app's return address isn't registered",
    body: 'The address the app asked to be sent back to does not match the one it registered with this instance. For your safety the sign-in was stopped here.'
  },
  invalid_request: {
    title: 'That sign-in request was incomplete',
    body: 'The app that sent you here left out something this instance needs, so the request could not be processed. Try starting the sign-in again from the app.'
  },
  invalid_request_uri: {
    title: 'That sign-in request was incomplete',
    body: 'The app that sent you here used a request format this instance does not support. Try starting the sign-in again from the app.'
  },
  // Like `access_denied` below, reported to the client's `redirect_uri` rather
  // than here (`formatErrorURL(query.redirect_uri, 'invalid_scope', …)`); there
  // is no `getErrorURL` call site for it. Mapped only for a client that hands
  // the code back to us by hand.
  invalid_scope: {
    title: "That app asked for permissions we don't offer",
    body: 'The app requested access this instance does not grant. Contact its developer — nothing was shared.'
  },
  unsupported_response_type: {
    title: 'That sign-in method is not supported',
    body: 'The app that sent you here asked for a sign-in flow this instance does not support. Contact its developer.'
  },
  unsupported_prompt_select_account: {
    title: 'That sign-in method is not supported',
    body: 'The app asked this instance to show an account picker, which it does not offer. Sign in normally instead, then switch accounts from your profile.'
  },
  // Also redirect_uri-routed, per RFC 6749 §4.1.2.1 — see `invalid_scope` above.
  access_denied: {
    title: 'Sign-in cancelled',
    body: 'You chose not to give that app access, so nothing was shared. You can start again whenever you like.'
  },
  // Core: `/api/auth/reset-password/:token` with a missing or expired token.
  INVALID_TOKEN: {
    title: 'This link is no longer valid',
    body: 'Password reset links expire, and each one can only be used once. Request a fresh link and use the newest email.'
  }
}

// Same shape better-auth's own error page accepts, minus the quote character it
// tolerates. The value is an opaque machine token, so anything outside this
// class is not a code we could have emitted.
const SAFE_ERROR_CODE = /^[A-Za-z0-9_-]+$/
const MAX_ERROR_CODE_LENGTH = 64

/**
 * Narrows the attacker-controlled `error` query parameter to something safe to
 * put on the page's technical-detail line. Anything that is not a bounded,
 * token-shaped string becomes `null` so the page shows nothing rather than
 * arbitrary text of arbitrary length.
 */
export const sanitizeAuthErrorCode = (
  raw: string | string[] | undefined
): string | null => {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return null
  if (value.length > MAX_ERROR_CODE_LENGTH) return null
  if (!SAFE_ERROR_CODE.test(value)) return null
  return value
}

/**
 * True when the code is one this instance can actually emit.
 *
 * Being token-shaped is NOT enough to put a code in front of a visitor:
 * `?error=Account-locked-please-call-1-800-555-0100` passes
 * `sanitizeAuthErrorCode` (41 characters, all in the allowed class) and reads as
 * ordinary prose. Echoing that under our own auth card is the same phishing
 * surface we refuse `error_description` for, just capped at 64 characters — so
 * the page renders the code only when this returns true, and the log gate uses
 * it too, to bound how much caller-chosen text an unauthenticated request can
 * push into the log stream.
 *
 * `Object.hasOwn`, not a bare lookup: `code` reaches this from the query string,
 * and a plain object literal answers `constructor`/`toString` with an inherited
 * function, which is truthy.
 */
export const isKnownAuthErrorCode = (code: string | null): boolean =>
  code !== null && Object.hasOwn(AUTH_ERROR_CONTENT, code)

/**
 * Resolves the copy for a sanitized error code. Unknown codes get the generic
 * fallback — the page never renders better-auth's `error_description`, which is
 * free text this instance does not control (see the page for why).
 */
export const resolveAuthErrorContent = (
  code: string | null
): AuthErrorContent =>
  isKnownAuthErrorCode(code)
    ? AUTH_ERROR_CONTENT[code as string]
    : AUTH_ERROR_FALLBACK
