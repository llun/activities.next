/**
 * Canonicalizes an email address for storage, lookup, and comparison.
 *
 * Email handling across the stack must be case-insensitive: a single canonical
 * form prevents casing differences from creating duplicate accounts, failing
 * sign-ins, or bypassing/false-blocking the `allowEmails` gate. This is the one
 * primitive every touchpoint (DB methods, the better-auth adapter, request
 * schemas, and `allowEmails` checks) routes through so they can never disagree.
 *
 * Normalization is intentionally minimal — trim surrounding whitespace and
 * lowercase — so it is reversible-enough to keep emails human-readable and does
 * not depend on any provider-specific rules.
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase()

/**
 * Case-insensitive `allowEmails` membership check. Normalizes both the input
 * email and every configured entry so the gate behaves identically regardless
 * of how the operator wrote the allowlist or how the user typed their address.
 * An empty allowlist means "no restriction", matching the call sites that only
 * enforce the gate when `allowEmails.length` is non-zero.
 */
export const isEmailAllowed = (
  allowEmails: string[],
  email: string
): boolean => {
  if (allowEmails.length === 0) return true
  const normalized = normalizeEmail(email)
  return allowEmails.some((allowed) => normalizeEmail(allowed) === normalized)
}
