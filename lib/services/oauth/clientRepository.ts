import {
  GrantIdentifier,
  OAuthClient,
  OAuthClientRepository
} from '@jmondi/oauth2-server'

import { Database } from '@/lib/database/types'

export class ClientRepository implements OAuthClientRepository {
  private storage: Database

  constructor(storage: Database) {
    this.storage = storage
  }

  async getByIdentifier(clientId: string): Promise<OAuthClient> {
    const application = await this.storage.getClientFromId({ clientId })
    if (!application) {
      throw new Error('Application is not exists')
    }
    return application
  }

  async isClientValid(
    grantType: GrantIdentifier,
    client: OAuthClient,
    clientSecret?: string
  ): Promise<boolean> {
    if (client.secret && client.secret !== clientSecret) {
      return false
    }
    return client.allowedGrants.includes(grantType)
  }
}
