// Coarse scopes that imply their dotted children. Mastodon's hierarchy:
//   read        ⊇ read:*
//   write       ⊇ write:*
//   admin:read  ⊇ admin:read:*
//   admin:write ⊇ admin:write:*
const COARSE_SCOPES = ['read', 'write', 'admin:read', 'admin:write'] as const

const isInScopeFamily = (scope: string, coarse: string) =>
  scope === coarse || scope.startsWith(`${coarse}:`)

/**
 * Decide whether a token's granted scopes satisfy a single required scope.
 *
 * Coarse → granular (Mastodon-standard): a granted coarse scope satisfies any
 * required child in its family, e.g. granted `read` satisfies required
 * `read:notifications`; granted `admin:read` satisfies `admin:read:domain_blocks`.
 *
 * The reverse direction (granular satisfying a coarse requirement) is
 * intentionally NOT implemented. Allowing it would over-grant: a token with
 * only `write:media` would satisfy any route guarded with `write`, which is
 * not what the user consented to when they authorized `write:media`. Routes
 * that need to accept granular-only tokens must explicitly list those scopes
 * (e.g. OAuthGuardAnyScope([write, write:statuses]) on the statuses route).
 */
export const hasGrantedScope = (
  grantedScopes: string[],
  requiredScope: string
): boolean => {
  if (grantedScopes.includes(requiredScope)) return true

  // Coarse → granular: a granted coarse parent satisfies a required child.
  for (const coarse of COARSE_SCOPES) {
    if (
      requiredScope !== coarse &&
      isInScopeFamily(requiredScope, coarse) &&
      grantedScopes.includes(coarse)
    ) {
      return true
    }
  }

  return false
}
