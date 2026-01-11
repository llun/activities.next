import { Knex } from 'knex'
import { omit } from 'lodash'

import { getCompatibleJSON } from '@/lib/database/sql/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { AccountDatabase } from '@/lib/database/types/account'
import { ActorDatabase } from '@/lib/database/types/actor'
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
} from '@/lib/database/types/oauth'
import { AuthCode } from '@/lib/models/oauth2/authCode'
import { Client } from '@/lib/models/oauth2/client'
import { Token } from '@/lib/models/oauth2/token'
import { User } from '@/lib/models/oauth2/user'

export const OAuthSQLDatabaseMixin = (
  database: Knex,
  accountDatabase: AccountDatabase,
  actorDatabase: ActorDatabase
): OAuthDatabase => ({
  async createClient(params: CreateClientParams) {
    const { name, redirectUris, secret, scopes, ...rest } =
      CreateClientParams.parse(params)
    const clientNameCountResult = await database('clients')
      .where('name', name)
      .count<{ count: string }>('id as count')
      .first()
    if (parseInt(clientNameCountResult?.count ?? '0', 10) > 0) {
      throw new Error(`Client ${name} is already exists`)
    }

    const id = crypto.randomUUID()
    const currentTime = new Date()
    const client = Client.parse({
      id,
      name,
      secret,

      scopes,
      redirectUris,

      ...(rest.website ? { website: rest.website } : null),

      createdAt: getCompatibleTime(currentTime),
      updatedAt: getCompatibleTime(currentTime)
    })
    await database('clients').insert({
      ...omit(client, ['allowedGrants']),
      scopes: JSON.stringify(scopes),
      redirectUris: JSON.stringify(redirectUris),
      createdAt: currentTime,
      updatedAt: currentTime
    })
    return client
  },

  async getClientFromName({ name }: GetClientFromNameParams) {
    const clientData = await database('clients').where('name', name).first()
    if (!clientData) return null
    const client = Client.parse({
      id: clientData.id,
      name: clientData.name,
      secret: clientData.secret,
      scopes: getCompatibleJSON(clientData.scopes),
      redirectUris: JSON.parse(clientData.redirectUris),
      ...(clientData.website ? { website: clientData.website } : null),
      updatedAt: getCompatibleTime(clientData.updatedAt),
      createdAt: getCompatibleTime(clientData.createdAt)
    })
    return client
  },

  async getClientFromId({ clientId }: GetClientFromIdParams) {
    const clientData = await database('clients').where('id', clientId).first()
    if (!clientData) return null
    return Client.parse({
      id: clientData.id,
      name: clientData.name,
      secret: clientData.secret,
      scopes: getCompatibleJSON(clientData.scopes),
      redirectUris: JSON.parse(clientData.redirectUris),
      ...(clientData.website ? { website: clientData.website } : null),
      updatedAt: getCompatibleTime(clientData.updatedAt),
      createdAt: getCompatibleTime(clientData.createdAt)
    })
  },

  async updateClient(params: UpdateClientParams) {
    const { id, name, secret, scopes, redirectUris, ...rest } =
      UpdateClientParams.parse(params)
    const client = await database('clients').where('id', id).first()
    if (!client) return null

    const currentTime = new Date()
    const updatedClient = Client.parse({
      id: client.id,
      name,
      secret,
      scopes,
      redirectUris,
      ...(rest.website ? { website: rest.website } : null),
      updatedAt: getCompatibleTime(currentTime),
      createdAt: getCompatibleTime(client.createdAt)
    })
    await database('clients')
      .where('id', id)
      .update({
        ...omit(updatedClient, ['allowedGrants', 'createdAt']),
        scopes: JSON.stringify(updatedClient.scopes.map((scope) => scope.name)),
        redirectUris: JSON.stringify(updatedClient.redirectUris),
        updatedAt: currentTime
      })
    return updatedClient
  },

  async getAccessToken({ accessToken }: GetAccessTokenParams) {
    const data = await database('tokens')
      .where('accessToken', accessToken)
      .first()
    if (!data) return null

    const client = await this.getClientFromId({ clientId: data.clientId })
    const actor = data.actorId
      ? await actorDatabase.getActorFromId({ id: data.actorId })
      : null
    const account = actor?.account

    return Token.parse({
      accessToken: data.accessToken,
      accessTokenExpiresAt: getCompatibleTime(data.accessTokenExpiresAt),

      ...(data.refreshToken ? { refreshToken: data.refreshToken } : null),
      ...(data.refreshTokenExpiresAt
        ? {
            refreshTokenExpiresAt: getCompatibleTime(data.refreshTokenExpiresAt)
          }
        : null),

      scopes: getCompatibleJSON(data.scopes),

      client: {
        ...client,
        scopes: client?.scopes.map((scope) => scope.name)
      },
      user: actor
        ? User.parse({
            id: actor?.id,
            actor,
            account
          })
        : null,

      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  },

  async getAccessTokenByRefreshToken(
    params: GetAccessTokenByRefreshTokenParams
  ) {
    const { refreshToken } = GetAccessTokenByRefreshTokenParams.parse(params)
    const result = await database('tokens')
      .where('refreshToken', refreshToken)
      .first()
    return this.getAccessToken({ accessToken: result.accessToken })
  },

  async createAccessToken(params: CreateAccessTokenParams) {
    const {
      accessToken,
      accessTokenExpiresAt,
      refreshToken,
      refreshTokenExpiresAt,
      clientId,
      scopes,
      actorId,
      accountId
    } = CreateAccessTokenParams.parse(params)
    const currentTime = new Date()
    const tokenCountResult = await database('tokens')
      .where('accessToken', accessToken)
      .count<{ count: string }>('accessToken as count')
      .first()
    if (parseInt(tokenCountResult?.count ?? '0', 10) > 0) return null

    const token = {
      accessToken,
      accessTokenExpiresAt: new Date(accessTokenExpiresAt),
      ...(refreshToken ? { refreshToken } : null),
      ...(refreshTokenExpiresAt
        ? { refreshTokenExpiresAt: new Date(refreshTokenExpiresAt) }
        : null),
      scopes: JSON.stringify(scopes),
      clientId,
      actorId,
      accountId,
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database('tokens').insert(token)
    return this.getAccessToken({ accessToken })
  },

  async updateRefreshToken(params: UpdateRefreshTokenParams) {
    const { accessToken, refreshToken, refreshTokenExpiresAt } =
      UpdateRefreshTokenParams.parse(params)
    const [tokenCount, refreshTokenCount] = await Promise.all([
      database('tokens')
        .where('accessToken', accessToken)
        .count<{ count: string }>('* as count')
        .first(),
      database('tokens')
        .where('refreshToken', refreshToken)
        .count<{ count: string }>('* as count')
        .first()
    ])
    if (!tokenCount || !parseInt(tokenCount.count, 10)) return null
    if (parseInt(refreshTokenCount?.count ?? '0', 10) > 0) {
      return null
    }
    await database('tokens')
      .where('accessToken', accessToken)
      .update({
        refreshToken,
        updatedAt: new Date(),
        ...(refreshTokenExpiresAt
          ? { refreshTokenExpiresAt: new Date(refreshTokenExpiresAt) }
          : null)
      })
    return this.getAccessToken({ accessToken })
  },

  async revokeAccessToken(params: RevokeAccessTokenParams) {
    const { accessToken } = RevokeAccessTokenParams.parse(params)
    const currentTime = new Date()
    await database('tokens').where('accessToken', accessToken).update({
      accessTokenExpiresAt: currentTime,
      refreshTokenExpiresAt: currentTime
    })
    return this.getAccessToken({ accessToken })
  },

  async touchAccessToken(params: TouchAccessTokenParams) {
    const { accessToken, accessTokenExpiresAt, refreshTokenExpiresAt } =
      TouchAccessTokenParams.parse(params)
    await database('tokens')
      .where('accessToken', accessToken)
      .update({
        accessTokenExpiresAt: new Date(accessTokenExpiresAt),
        ...(refreshTokenExpiresAt
          ? { refreshTokenExpiresAt: new Date(refreshTokenExpiresAt) }
          : {}),
        updatedAt: new Date()
      })
  },

  async createAuthCode(params: CreateAuthCodeParams) {
    const {
      code,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      actorId,
      accountId,
      clientId,
      scopes,
      expiresAt
    } = CreateAuthCodeParams.parse(params)
    const currentTime = new Date()
    const codeCountResult = await database('auth_codes')
      .where('code', code)
      .count<{ count: string }>('* as count')
      .first()
    if (parseInt(codeCountResult?.count ?? '0', 10) > 0) {
      return null
    }

    const actor = await actorDatabase.getActorFromId({ id: actorId })
    if (!actor?.account || actor.account.id !== accountId) return null

    const authCode = {
      code,
      ...(redirectUri ? { redirectUri } : null),
      ...(codeChallenge ? { codeChallenge } : null),
      ...(codeChallengeMethod ? { codeChallengeMethod } : null),
      scopes: JSON.stringify(scopes),
      clientId,
      actorId,
      accountId,
      expiresAt: new Date(expiresAt),
      createdAt: currentTime,
      updatedAt: currentTime
    }
    await database('auth_codes').insert(authCode)
    return this.getAuthCode({ code })
  },

  async getAuthCode(params: GetAuthCodeParams) {
    const { code } = GetAuthCodeParams.parse(params)
    const data = await database('auth_codes').where('code', code).first()
    if (!data) return null

    const [client, actor, account] = await Promise.all([
      this.getClientFromId({ clientId: data.clientId }),
      actorDatabase.getActorFromId({ id: data.actorId }),
      accountDatabase.getAccountFromId({ id: data.accountId })
    ])

    return AuthCode.parse({
      code: data.code,
      ...(data.redirectUri ? { redirectUri: data.redirectUri } : null),
      ...(data.codeChallenge ? { codeChallenge: data.codeChallenge } : null),
      ...(data.codeChallengeMethod
        ? { codeChallengeMethod: data.codeChallengeMethod }
        : null),

      scopes: getCompatibleJSON(data.scopes),
      client: {
        ...client,
        scopes: client?.scopes.map((scope) => scope.name)
      },
      user: User.parse({
        id: actor?.id,
        actor,
        account
      }),

      expiresAt: getCompatibleTime(data.expiresAt),
      createdAt: getCompatibleTime(data.createdAt),
      updatedAt: getCompatibleTime(data.updatedAt)
    })
  },

  async revokeAuthCode(params: RevokeAuthCodeParams) {
    const { code } = RevokeAuthCodeParams.parse(params)
    const currentTime = new Date()
    await database('auth_codes').where('code', code).update({
      expiresAt: currentTime
    })
    return this.getAuthCode({ code })
  }
})
