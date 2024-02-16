import { OAuthScope, OAuthScopeRepository } from '@jmondi/oauth2-server'

import { Scopes } from '@/lib/storage/types/oauth'

export class ScopeRepository implements OAuthScopeRepository {
  async getAllByIdentifiers(scopeNames: string[]): Promise<OAuthScope[]> {
    const scopes = scopeNames
      .map((scope) => Scopes.parse(scope))
      .map((name) => ({ name }))
    return scopes
  }

  async finalize(scopes: OAuthScope[]): Promise<OAuthScope[]> {
    return scopes
  }
}
