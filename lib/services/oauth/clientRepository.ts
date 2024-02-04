import {
  GrantIdentifier,
  OAuthClient,
  OAuthClientRepository
} from '@jmondi/oauth2-server'

import { Storage } from '@/lib/storage/types'

export class ClientRepository implements OAuthClientRepository {
  private storage: Storage

  constructor(storage: Storage) {
    this.storage = storage
  }

  async getByIdentifier(clientId: string): Promise<OAuthClient> {
    const application = await this.storage.getApplicationFromId({ clientId })
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
