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
  database: Database

  constructor(database: Database) {
    this.database = database
  }

  async findById(accessToken: string): Promise<OAuthToken> {
    const token = await this.database.getAccessToken({ accessToken })
    if (!token) throw new Error('Fail to find token')
    return token
  }

  async issueToken(
    client: OAuthClient,
    scopes: OAuthScope[],
    user?: OAuthUser
  ): Promise<OAuthToken> {
    const currentTime = Date.now()
    const accessToken = generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH)
    const token = Token.parse({
      accessToken,
      accessTokenExpiresAt: new DateInterval('7d').getEndDate().getTime(),
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
    await this.database.createAccessToken({
      accessToken: token.accessToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt.getTime(),
      refreshToken: token.refreshToken,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt?.getTime(),
      accountId: token.user?.account?.id ?? null,
      actorId: token.user?.actor?.id ?? null,
      clientId: token.client.id,
      scopes: token.scopes.map((scope) => scope.name as Scope)
    })
    return token
  }

  async getByRefreshToken(refreshToken: string): Promise<OAuthToken> {
    const token = await this.database.getAccessTokenByRefreshToken({
      refreshToken
    })
    if (!token) throw new Error('Fail to find refresh token')
    return token
  }

  async isRefreshTokenRevoked(token: OAuthToken): Promise<boolean> {
    return Date.now() > (token.refreshTokenExpiresAt?.getTime() ?? 0)
  }

  async issueRefreshToken(token: OAuthToken): Promise<OAuthToken> {
    const updatedToken = await this.database.updateRefreshToken({
      accessToken: token.accessToken,
      refreshToken: generateRandomToken(DEFAULT_OAUTH_TOKEN_LENGTH),
      refreshTokenExpiresAt: new DateInterval('30d').getEndDate().getTime()
    })
    if (!updatedToken) throw new Error('Fail to issue refresh token')
    return updatedToken
  }

  async persist(token: OAuthToken): Promise<void> {
    const existingToken = await this.database.getAccessToken({
      accessToken: token.accessToken
    })
    if (existingToken) return

    await this.database.createAccessToken({
      accessToken: token.accessToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt.getTime(),
      refreshToken: token.refreshToken,
      refreshTokenExpiresAt: token.refreshTokenExpiresAt?.getTime(),
      accountId: token.user?.account?.id ?? null,
      actorId: token.user?.actor?.id ?? null,
      clientId: token.client.id,
      scopes: token.scopes.map((scope) => scope.name as Scope)
    })
  }

  async revoke(token: OAuthToken): Promise<void> {
    await this.database.revokeAccessToken({ accessToken: token.accessToken })
  }
}
