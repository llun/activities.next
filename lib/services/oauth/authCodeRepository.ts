import {
  OAuthAuthCode,
  OAuthAuthCodeRepository,
  OAuthClient,
  OAuthScope,
  OAuthUser
} from '@jmondi/oauth2-server'
import {
  DateInterval,
  generateRandomToken
} from 'node_modules/@jmondi/oauth2-server/dist/index.cjs'

import { AuthCode } from '@/lib/models/oauth2/authCode'
import { Storage } from '@/lib/storage/types'
import { Scopes } from '@/lib/storage/types/oauth'

export class AuthCodeRepository implements OAuthAuthCodeRepository {
  storage: Storage
  constructor(storage: Storage) {
    this.storage = storage
  }

  async getByIdentifier(authCodeCode: string): Promise<OAuthAuthCode> {
    const authCode = await this.storage.getAuthCode({ code: authCodeCode })
    if (!authCode) throw new Error('Fail to find auth code')
    return authCode
  }

  async isRevoked(authCodeCode: string): Promise<boolean> {
    const authCode = await this.getByIdentifier(authCodeCode)
    return Date.now() > authCode.expiresAt.getTime()
  }

  issueAuthCode(
    client: OAuthClient,
    user: OAuthUser | undefined,
    scopes: OAuthScope[]
  ): OAuthAuthCode {
    const currentTime = Date.now()
    return AuthCode.parse({
      code: generateRandomToken(),
      redirectUri: null,
      codeChallenge: null,
      codeChallengeMethod: 'S256',

      user,
      client: {
        ...client,
        scopes: client.scopes.map((scope) => scope.name)
      },
      scopes: scopes.map((scope) => scope.name),

      expiresAt: new DateInterval('15m').getEndDate().getTime(),
      createdAt: currentTime,
      updatedAt: currentTime
    })
  }

  async persist(authCodeCode: OAuthAuthCode): Promise<void> {
    await this.storage.createAuthCode({
      code: authCodeCode.code,
      redirectUri: authCodeCode.redirectUri,
      codeChallenge: authCodeCode.codeChallenge,
      codeChallengeMethod: authCodeCode.codeChallengeMethod,
      clientId: authCodeCode.client.id,
      actorId: authCodeCode.user?.actor.id,
      accountId: authCodeCode.user?.account.id,
      scopes: authCodeCode.scopes.map((scope) => scope.name as Scopes),
      expiresAt: authCodeCode.expiresAt.getTime()
    })
  }

  async revoke(authCodeCode: string): Promise<void> {
    await this.storage.revokeAuthCode({ code: authCodeCode })
  }
}
