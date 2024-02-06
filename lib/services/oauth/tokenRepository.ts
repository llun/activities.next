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

export class TokenRepository implements OAuthTokenRepository {
  storage: Storage

  constructor(storage: Storage) {
    this.storage = storage
  }

  async findById(accessToken: string): Promise<OAuthToken> {
    console.log('findById', accessToken)
    throw new Error('No implementation')
  }

  async issueToken(
    client: OAuthClient,
    scopes: OAuthScope[],
    user?: OAuthUser
  ): Promise<OAuthToken> {
    const token = Token.parse({
      accessToken: generateRandomToken(),
      accessTokenExpiresAt: new DateInterval('30d').getEndDate(),
      refreshToken: null,
      refreshTokenExpiresAt: null,
      clientId: client.id,
      accountId: user?.id,
      scopes: scopes.map((scope) => scope.name)
    })
    console.log('issueToken', token)
    throw new Error('No implementation')
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
    console.log('persist', token)
    throw new Error('No implementation')
  }

  async revoke(accessToken: OAuthToken): Promise<void> {
    console.log('revoke', accessToken)
    throw new Error('No implementation')
  }
}
