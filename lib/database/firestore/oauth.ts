import { Firestore } from '@google-cloud/firestore'

import { getCompatibleTime } from '@/lib/database/firestore/utils'
import {
  CreateAccessTokenParams,
  CreateAuthCodeParams,
  CreateClientParams,
  GetAccessTokenByRefreshTokenParams,
  GetAccessTokenParams,
  GetAuthCodeParams,
  GetClientFromIdParams,
  GetClientFromNameParams,
  OAuthDatabase,
  RevokeAccessTokenParams,
  RevokeAuthCodeParams,
  TouchAccessTokenParams,
  UpdateClientParams,
  UpdateRefreshTokenParams
} from '@/lib/types/database/operations'
import { AuthCode } from '@/lib/types/oauth2/authCode'
import { Client } from '@/lib/types/oauth2/client'
import { Token } from '@/lib/types/oauth2/token'

export const OAuthFirestoreDatabaseMixin = (
  database: Firestore,
  _accountDatabase: any,
  _actorDatabase: any
): OAuthDatabase => ({
  async createClient(params: CreateClientParams): Promise<Client | null> {
    const id = crypto.randomUUID()
    const currentTime = new Date()
    const data = {
      ...params,
      id,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database.collection('oauth_clients').doc(id).set(data)
    return this.getClientFromId({ clientId: id })
  },

  async getClientFromName({
    name
  }: GetClientFromNameParams): Promise<Client | null> {
    const result = await database
      .collection('oauth_clients')
      .where('name', '==', name)
      .limit(1)
      .get()
    if (result.empty) return null
    const data = result.docs[0].data() as any
    return Client.parse({
      ...data,
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  },

  async getClientFromId({
    clientId
  }: GetClientFromIdParams): Promise<Client | null> {
    const doc = await database.collection('oauth_clients').doc(clientId).get()
    if (!doc.exists) return null
    const data = doc.data() as any
    return Client.parse({
      ...data,
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  },

  async updateClient(params: UpdateClientParams): Promise<Client | null> {
    const { id, ...updateParams } = params
    await database.collection('oauth_clients').doc(id).update({
      ...updateParams,
      updatedAt: new Date()
    })
    return this.getClientFromId({ clientId: id })
  },

  async getAccessToken({
    accessToken
  }: GetAccessTokenParams): Promise<Token | null> {
    const doc = await database.collection('oauth_tokens').doc(accessToken).get()
    if (!doc.exists) return null
    const data = doc.data() as any
    return Token.parse({
      ...data,
      accessTokenExpiresAt: getCompatibleTime(data.accessTokenExpiresAt),
      refreshTokenExpiresAt: getCompatibleTime(data.refreshTokenExpiresAt),
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  },

  async getAccessTokenByRefreshToken({
    refreshToken
  }: GetAccessTokenByRefreshTokenParams): Promise<Token | null> {
    const result = await database
      .collection('oauth_tokens')
      .where('refreshToken', '==', refreshToken)
      .limit(1)
      .get()
    if (result.empty) return null
    const data = result.docs[0].data() as any
    return Token.parse({
      ...data,
      accessTokenExpiresAt: getCompatibleTime(data.accessTokenExpiresAt),
      refreshTokenExpiresAt: getCompatibleTime(data.refreshTokenExpiresAt),
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  },

  async createAccessToken(params: CreateAccessTokenParams): Promise<Token | null> {
    const currentTime = new Date()
    const data = {
      ...params,
      accessTokenExpiresAt: new Date(params.accessTokenExpiresAt),
      refreshTokenExpiresAt: params.refreshTokenExpiresAt
        ? new Date(params.refreshTokenExpiresAt)
        : null,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database.collection('oauth_tokens').doc(params.accessToken).set(data)
    return this.getAccessToken({ accessToken: params.accessToken })
  },

  async updateRefreshToken({
    accessToken,
    refreshToken,
    refreshTokenExpiresAt
  }: UpdateRefreshTokenParams): Promise<Token | null> {
    await database.collection('oauth_tokens').doc(accessToken).update({
      refreshToken,
      refreshTokenExpiresAt: refreshTokenExpiresAt
        ? new Date(refreshTokenExpiresAt)
        : null,
      updatedAt: new Date()
    })
    return this.getAccessToken({ accessToken })
  },

  async revokeAccessToken({
    accessToken
  }: RevokeAccessTokenParams): Promise<Token | null> {
    const token = await this.getAccessToken({ accessToken })
    if (!token) return null
    await database.collection('oauth_tokens').doc(accessToken).delete()
    return token
  },

  async touchAccessToken({
    accessToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt
  }: TouchAccessTokenParams): Promise<void> {
    await database.collection('oauth_tokens').doc(accessToken).update({
      accessTokenExpiresAt: new Date(accessTokenExpiresAt),
      ...(refreshTokenExpiresAt
        ? { refreshTokenExpiresAt: new Date(refreshTokenExpiresAt) }
        : {}),
      updatedAt: new Date()
    })
  },

  async createAuthCode(params: CreateAuthCodeParams): Promise<AuthCode | null> {
    const currentTime = new Date()
    const data = {
      ...params,
      expiresAt: new Date(params.expiresAt),
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database.collection('oauth_auth_codes').doc(params.code).set(data)
    return this.getAuthCode({ code: params.code })
  },

  async getAuthCode({ code }: GetAuthCodeParams): Promise<AuthCode | null> {
    const doc = await database.collection('oauth_auth_codes').doc(code).get()
    if (!doc.exists) return null
    const data = doc.data() as any
    return AuthCode.parse({
      ...data,
      expiresAt: getCompatibleTime(data.expiresAt),
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  },

  async revokeAuthCode({ code }: RevokeAuthCodeParams): Promise<AuthCode | null> {
    const authCode = await this.getAuthCode({ code })
    if (!authCode) return null
    await database.collection('oauth_auth_codes').doc(code).delete()
    return authCode
  }
})
