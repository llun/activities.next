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
 * Two relationships make a required scope satisfied:
 *  1. Coarse → granular (Mastodon-standard): a granted coarse scope satisfies
 *     any required child, e.g. granted `read` satisfies required
 *     `read:notifications`, and granted `admin:read` satisfies required
 *     `admin:read:domain_blocks`.
 *  2. Granular → coarse (our routes express read/write intent only at coarse
 *     granularity): when a coarse scope is required, any granted granular scope
 *     of the same family satisfies it, e.g. granted `read:notifications`
 *     satisfies required `read`. This keeps granular-only tokens from getting a
 *     confusing 401 on a route guarded with the coarse scope, while never
 *     letting one family reach another (a `read:*` token never satisfies
 *     `write` or `admin:read`).
 */
export const hasGrantedScope = (
  grantedScopes: string[],
  requiredScope: string
): boolean => {
  if (grantedScopes.includes(requiredScope)) return true

  // 1) Coarse → granular: a granted coarse parent satisfies a required child.
  for (const coarse of COARSE_SCOPES) {
    if (
      requiredScope !== coarse &&
      isInScopeFamily(requiredScope, coarse) &&
      grantedScopes.includes(coarse)
    ) {
      return true
    }
  }

  // 2) Granular → coarse: a required coarse scope is satisfied by any granted
  //    granular scope in the same family.
  if ((COARSE_SCOPES as readonly string[]).includes(requiredScope)) {
    return grantedScopes.some(
      (granted) =>
        granted !== requiredScope && isInScopeFamily(granted, requiredScope)
    )
  }

  return false
}
