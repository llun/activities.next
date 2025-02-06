import { OAuthScope, OAuthScopeRepository } from '@jmondi/oauth2-server'

import { Scope } from '@/lib/database/types/oauth'

export class ScopeRepository implements OAuthScopeRepository {
  async getAllByIdentifiers(scopeNames: string[]): Promise<OAuthScope[]> {
    const scopes = scopeNames
      .map((scope) => Scope.parse(scope))
      .map((name) => ({ name }))
    return scopes
  }

  async finalize(scopes: OAuthScope[]): Promise<OAuthScope[]> {
    return scopes
  }
}
