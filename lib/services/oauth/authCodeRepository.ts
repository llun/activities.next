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

import { DEFAULT_OAUTH_TOKEN_LENGTH } from '@/lib/constants'
import { Database } from '@/lib/database/types'
import { Scope } from '@/lib/database/types/oauth'
import { AuthCode } from '@/lib/models/oauth2/authCode'

export class AuthCodeRepository implements OAuthAuthCodeRepository {
  database: Database
  constructor(database: Database) {
    this.database = database
  }

  async getByIdentifier(authCodeCode: string): Promise<OAuthAuthCode> {
    const authCode = await this.database.getAuthCode({ code: authCodeCode })
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
      code: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
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
    await this.database.createAuthCode({
      code: authCodeCode.code,
      redirectUri: authCodeCode.redirectUri,
      codeChallenge: authCodeCode.codeChallenge,
      codeChallengeMethod: authCodeCode.codeChallengeMethod,
      clientId: authCodeCode.client.id,
      actorId: authCodeCode.user?.actor.id,
      accountId: authCodeCode.user?.account.id,
      scopes: authCodeCode.scopes.map((scope) => scope.name as Scope),
      expiresAt: authCodeCode.expiresAt.getTime()
    })
  }

  async revoke(authCodeCode: string): Promise<void> {
    await this.database.revokeAuthCode({ code: authCodeCode })
  }
}
