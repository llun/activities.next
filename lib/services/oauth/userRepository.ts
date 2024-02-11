import {
  GrantIdentifier,
  OAuthClient,
  OAuthUser,
  OAuthUserRepository
} from '@jmondi/oauth2-server'

import { Storage } from '@/lib/storage/types'

export class UserRepository implements OAuthUserRepository {
  storage: Storage

  constructor(storage: Storage) {
    this.storage = storage
  }

  async getUserByCredentials(
    identifier: string,
    password?: string,
    grantType?: GrantIdentifier,
    client?: OAuthClient
  ): Promise<OAuthUser> {
    console.log('getUserByCredentials', identifier, password, grantType, client)
    throw new Error('No implementation')
  }
}
