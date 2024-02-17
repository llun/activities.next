import {
  OAuthAuthCode,
  OAuthAuthCodeRepository,
  OAuthClient,
  OAuthScope,
  OAuthUser
} from '@jmondi/oauth2-server'

import { Storage } from '@/lib/storage/types'
import { AuthCode } from '@/lib/models/oauth2/authCode'
import { DateInterval, generateRandomToken } from 'node_modules/@jmondi/oauth2-server/dist/index.cjs'

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
    return AuthCode.parse({
      code: generateRandomToken(),
      redirectUri: null,
      codeChallenge: null,
      codeChallengeMethod: "S256",
      expiresAt: new DateInterval("15m").getEndDate(),
      client,
      clientId: client.id,
      user,
      userId: user?.id ?? null,
      scopes,
    })

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
