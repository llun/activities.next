// Sentinel origin used only to resolve a candidate redirect target. Its exact
// value is irrelevant — it just has to be an origin nothing else can match.
const SENTINEL_ORIGIN = 'https://internal.invalid'

/**
 * Whether `value` is a safe same-origin redirect target (an absolute internal
 * path), guarding the post-login / post-2FA redirects against open redirects
 * (CWE-601).
 *
 * It resolves the candidate the way the browser / WHATWG URL parser does, so it
 * also rejects the bypasses a naive `startsWith('/') && !startsWith('//')` check
 * misses: backslashes and tab/newline characters get normalized such that e.g.
 * `/\evil.com` and `/<tab>/evil.com` resolve to an off-origin `https://evil.com/`.
 * A value is safe only if it starts with `/` and still resolves to the sentinel
 * origin (i.e. it never escapes to another host).
 */
export const isSafeInternalPath = (
  value: string | null | undefined
): boolean => {
  if (!value || !value.startsWith('/')) return false
  try {
    return new URL(value, SENTINEL_ORIGIN).origin === SENTINEL_ORIGIN
  } catch {
    return false
  }
}
