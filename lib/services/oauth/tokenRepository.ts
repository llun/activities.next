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
    console.log('getByRefreshToken', refreshToken)
    throw new Error('No implementation')
  }

  async isRefreshTokenRevoked(token: OAuthToken): Promise<boolean> {
    return Date.now() > (token.refreshTokenExpiresAt?.getTime() ?? 0)
  }

  async issueRefreshToken(
    token: OAuthToken,
    client: OAuthClient
  ): Promise<OAuthToken> {
    console.log('issueRefreshToken', token, client)
    throw new Error('No implementation')
  }

  async persist(token: OAuthToken): Promise<void> {
    const existingToken = await this.storage.getAccessToken({
      accessToken: token.accessToken
    })
    if (!existingToken) {
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
      return
    }
    throw new Error('No implementation')
  }

  async revoke(accessToken: OAuthToken): Promise<void> {
    console.log('revoke', accessToken)
    throw new Error('No implementation')
  }
}
