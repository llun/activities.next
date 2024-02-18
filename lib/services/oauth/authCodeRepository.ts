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
    const authCode = await this.getByIdentifier(authCodeCode);
    return Date.now() > authCode.expiresAt.getTime();
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
    await this.storage.createAuthCode({
      code: authCodeCode.code,
      redirectUri: authCodeCode.redirectUri,
      codeChallenge: authCodeCode.codeChallenge,
      codeChallengeMethod: authCodeCode.codeChallengeMethod,
      clientId: authCodeCode.client.id,
      actorId: authCodeCode.user?.userId,
      accountId: authCodeCode.user?.accountId,
      scopes: authCodeCode.scopes.map((scope) => scope.name as Scopes),
      expiresAt: authCodeCode.expiresAt.getTime(),
    })
  }

  async revoke(authCodeCode: string): Promise<void> {
    console.log('revoke', authCodeCode)
    throw new Error('No implementation')
  }
}
