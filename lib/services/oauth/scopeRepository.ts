import { OAuthScope, OAuthScopeRepository } from '@jmondi/oauth2-server'

export class ScopeRepository implements OAuthScopeRepository {
  async getAllByIdentifiers(scopeNames: string[]): Promise<OAuthScope[]> {
    console.log('getAllByIdentifiers', scopeNames)
    throw new Error('No implementation')
  }

  async finalize(scopes: OAuthScope[]): Promise<OAuthScope[]> {
    return scopes
  }
}
