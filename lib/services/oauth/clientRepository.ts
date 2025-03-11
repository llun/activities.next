import {
  GrantIdentifier,
  OAuthClient,
  OAuthClientRepository
} from '@jmondi/oauth2-server'

import { Database } from '@/lib/database/types'

export class ClientRepository implements OAuthClientRepository {
  private database: Database

  constructor(database: Database) {
    this.database = database
  }

  async getByIdentifier(clientId: string): Promise<OAuthClient> {
    const application = await this.database.getClientFromId({ clientId })
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
    const isSecretValid =
      Boolean(client.secret) && client.secret === clientSecret
    const isGrantAllowed = client.allowedGrants.includes(grantType)
    return isSecretValid && isGrantAllowed
  }
}
