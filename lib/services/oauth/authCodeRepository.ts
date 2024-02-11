import {
  OAuthAuthCode,
  OAuthAuthCodeRepository,
  OAuthClient,
  OAuthScope,
  OAuthUser
} from '@jmondi/oauth2-server'

import { Storage } from '@/lib/storage/types'

export class AuthCodeRepository implements OAuthAuthCodeRepository {
  storage: Storage
  constructor(storage: Storage) {
    this.storage = storage
  }

  async getByIdentifier(authCodeCode: string): Promise<OAuthAuthCode> {
    console.log('getByIdentifier', authCodeCode)
    throw new Error('No implementation')
  }

  async isRevoked(authCodeCode: string): Promise<boolean> {
    console.log('isRevoked', authCodeCode)
    throw new Error('No implementation')
  }

  issueAuthCode(
    client: OAuthClient,
    user: OAuthUser | undefined,
    scopes: OAuthScope[]
  ): OAuthAuthCode {
    console.log('issueAuthCode', client, user, scopes)
    throw new Error('No implementations')
  }

  async persist(authCodeCode: OAuthAuthCode): Promise<void> {
    console.log('persist', authCodeCode)
    throw new Error('No implementation')
  }

  async revoke(authCodeCode: string): Promise<void> {
    console.log('revoke', authCodeCode)
    throw new Error('No implementation')
  }
}
