import {
  DateInterval,
  OAuthClient,
  OAuthScope,
  OAuthToken,
  OAuthTokenRepository,
  OAuthUser,
  generateRandomToken
} from '@jmondi/oauth2-server'

import { Token } from '@/lib/models/oauth2/token'
import { Storage } from '@/lib/storage/types'
import { Scopes } from '@/lib/storage/types/oauth'

export class TokenRepository implements OAuthTokenRepository {
  storage: Storage

  constructor(storage: Storage) {
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
      accessToken: generateRandomToken(),
      accessTokenExpiresAt: new DateInterval('30d').getEndDate(),
      refreshToken: null,
      refreshTokenExpiresAt: null,
      client,
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
      refreshToken: generateRandomToken(),
      refreshTokenExpiresAt: new DateInterval('2h').getEndDate().getTime()
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
      accountId: token.user?.accountId,
      actorId: token.user?.userId,
      clientId: token.client.id,
      scopes: token.scopes.map((scope) => scope.name as Scopes)
    })
  }

  async revoke(token: OAuthToken): Promise<void> {
    await this.storage.revokeAccessToken({ accessToken: token.accessToken })
  }
}
