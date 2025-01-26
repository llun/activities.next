import {
  DateInterval,
  OAuthClient,
  OAuthScope,
  OAuthToken,
  OAuthTokenRepository,
  OAuthUser,
  generateRandomToken
} from '@jmondi/oauth2-server'

import { DEFAULT_OAUTH_TOKEN_LENGTH } from '@/lib/constants'
import { Database } from '@/lib/database/types'
import { Scope } from '@/lib/database/types/oauth'
import { Token } from '@/lib/models/oauth2/token'

export class TokenRepository implements OAuthTokenRepository {
  storage: Database

  constructor(storage: Database) {
    this.storage = storage
  }

  async findById(accessToken: string): Promise<OAuthToken> {
    const token = await this.storage.getAccessToken({ accessToken })
    if (!token) throw new Error('Fail to find token')
    return token
  }

  async issueToken(
    client: OAuthClient,
    scopes: OAuthScope[],
    user?: OAuthUser
  ): Promise<OAuthToken> {
    const currentTime = Date.now()
    return Token.parse({
      accessToken: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
      accessTokenExpiresAt: new DateInterval('15m').getEndDate().getTime(),
      refreshToken: null,
      refreshTokenExpiresAt: null,
      client: {
        ...client,
        scopes: client.scopes.map((scope) => scope.name)
      },
      user,
      scopes: scopes.map((scope) => scope.name),
      createdAt: currentTime,
      updatedAt: currentTime
    })
  }

  async getByRefreshToken(refreshToken: string): Promise<OAuthToken> {
    const token = await this.storage.getAccessTokenByRefreshToken({
      refreshToken
    })
    if (!token) throw new Error('Fail to find refresh token')
    return token
  }

  async isRefreshTokenRevoked(token: OAuthToken): Promise<boolean> {
    return Date.now() > (token.refreshTokenExpiresAt?.getTime() ?? 0)
  }

  async issueRefreshToken(token: OAuthToken): Promise<OAuthToken> {
    const updatedToken = await this.storage.updateRefreshToken({
      accessToken: token.accessToken,
      refreshToken: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
      refreshTokenExpiresAt: new DateInterval('7d').getEndDate().getTime()
    })
    if (!updatedToken) throw new Error('Fail to issue refresh token')
    return updatedToken
  }

  async persist(token: OAuthToken): Promise<void> {
    const existingToken = await this.storage.getAccessToken({
      accessToken: token.accessToken
    })
    if (existingToken) return

    await this.storage.createAccessToken({
      accessToken: token.accessToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt.getTime(),
      refreshToken: token.refreshToken,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt?.getTime(),
      accountId: token.user?.account.id,
      actorId: token.user?.actor.id,
      clientId: token.client.id,
      scopes: token.scopes.map((scope) => scope.name as Scope)
    })
  }

  async revoke(token: OAuthToken): Promise<void> {
    await this.storage.revokeAccessToken({ accessToken: token.accessToken })
  }
}
