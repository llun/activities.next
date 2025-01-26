import { Knex } from 'knex'
import { omit } from 'lodash'

import { AccountStorage } from '@/lib/database/types/acount'
import { ActorStorage } from '@/lib/database/types/actor'
import {
  CreateAccessTokenParams,
  CreateAuthCodeParams,
  CreateClientParams,
  GetAccessTokenByRefreshTokenParams,
  GetAccessTokenParams,
  GetAuthCodeParams,
  GetClientFromIdParams,
  GetClientFromNameParams,
  OAuthStorage,
  RevokeAccessTokenParams,
  RevokeAuthCodeParams,
  UpdateClientParams,
  UpdateRefreshTokenParams
} from '@/lib/database/types/oauth'
import { AuthCode } from '@/lib/models/oauth2/authCode'
import { Client } from '@/lib/models/oauth2/client'
import { Token } from '@/lib/models/oauth2/token'
import { User } from '@/lib/models/oauth2/user'

export const OAuthStorageMixin = (
  database: Knex,
  accountStorage: AccountStorage,
  actorStorage: ActorStorage
): OAuthStorage => ({
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
    const currentTime = Date.now()
    const client = Client.parse({
      id,
      name,
      secret,

      scopes,
      redirectUris,

      ...(rest.website ? { website: rest.website } : null),

      createdAt: currentTime,
      updatedAt: currentTime
    })
    await database('clients').insert({
      ...omit(client, ['allowedGrants']),
      scopes: JSON.stringify(scopes),
      redirectUris: JSON.stringify(redirectUris)
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
      scopes: JSON.parse(clientData.scopes),
      redirectUris: JSON.parse(clientData.redirectUris),
      ...(clientData.website ? { website: clientData.website } : null),
      updatedAt: clientData.updatedAt,
      createdAt: clientData.createdAt
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
      scopes: JSON.parse(clientData.scopes),
      redirectUris: JSON.parse(clientData.redirectUris),
      ...(clientData.website ? { website: clientData.website } : null),
      updatedAt: clientData.updatedAt,
      createdAt: clientData.createdAt
    })
  },

  async updateClient(params: UpdateClientParams) {
    const { id, name, secret, scopes, redirectUris, ...rest } =
      UpdateClientParams.parse(params)
    const client = await database('clients').where('id', id).first()
    if (!client) return null

    const currentTime = Date.now()
    const updatedClient = Client.parse({
      id: client.id,
      name,
      secret,
      scopes,
      redirectUris,
      ...(rest.website ? { website: rest.website } : null),
      updatedAt: currentTime,
      createdAt: client.createdAt
    })
    await database('clients')
      .where('id', id)
      .update({
        ...omit(updatedClient, ['allowedGrants']),
        scopes: JSON.stringify(updatedClient.scopes.map((scope) => scope.name)),
        redirectUris: JSON.stringify(updatedClient.redirectUris)
      })
    return updatedClient
  },

  async getAccessToken({ accessToken }: GetAccessTokenParams) {
    const data = await database('tokens')
      .where('accessToken', accessToken)
      .first()
    if (!data) return null

    const [client, actor, account] = await Promise.all([
      this.getClientFromId({ clientId: data.clientId }),
      actorStorage.getActorFromId({ id: data.actorId }),
      accountStorage.getAccountFromId({ id: data.accountId })
    ])

    return Token.parse({
      accessToken: data.accessToken,
      accessTokenExpiresAt: data.accessTokenExpiresAt,

      ...(data.refreshToken ? { refreshToken: data.refreshToken } : null),
      ...(data.refreshTokenExpiresAt
        ? { refreshTokenExpiresAt: data.refreshTokenExpiresAt }
        : null),

      scopes: JSON.parse(data.scopes),

      client: {
        ...client,
        scopes: client?.scopes.map((scope) => scope.name)
      },
      user: User.parse({
        id: actor?.id,
        actor: actor?.data,
        account
      }),

      createdAt: data.createdAt,
      updatedAt: data.updatedAt
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
    const currentTime = Date.now()
    const tokenCountResult = await database('tokens')
      .where('accessToken', accessToken)
      .count<{ count: string }>('accessToken as count')
      .first()
    if (parseInt(tokenCountResult?.count ?? '0', 10) > 0) return null

    const actor = await actorStorage.getActorFromId({ id: actorId })
    if (!actor?.account || actor.account.id !== accountId) return null

    const token = {
      accessToken,
      accessTokenExpiresAt,
      ...(refreshToken ? { refreshToken } : null),
      ...(refreshTokenExpiresAt ? { refreshTokenExpiresAt } : null),
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
    if (!tokenCount?.count) return null
    if (parseInt(refreshTokenCount?.count ?? '0', 10) > 0) {
      return null
    }
    await database('tokens').where('accessToken', accessToken).update({
      refreshToken,
      refreshTokenExpiresAt,
      updatedAt: Date.now()
    })
    return this.getAccessToken({ accessToken })
  },

  async revokeAccessToken(params: RevokeAccessTokenParams) {
    const { accessToken } = RevokeAccessTokenParams.parse(params)
    const currentTime = Date.now()
    await database('tokens').where('accessToken', accessToken).update({
      accessTokenExpiresAt: currentTime,
      refreshTokenExpiresAt: currentTime
    })
    return this.getAccessToken({ accessToken })
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
    const currentTime = Date.now()
    const codeCountResult = await database('auth_codes')
      .where('code', code)
      .count<{ count: string }>('* as count')
      .first()
    if (parseInt(codeCountResult?.count ?? '0', 10) > 0) {
      return null
    }

    const actor = await actorStorage.getActorFromId({ id: actorId })
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
      expiresAt,
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
      actorStorage.getActorFromId({ id: data.actorId }),
      accountStorage.getAccountFromId({ id: data.accountId })
    ])

    return AuthCode.parse({
      code: data.code,
      ...(data.redirectUri ? { redirectUri: data.redirectUri } : null),
      ...(data.codeChallenge ? { codeChallenge: data.codeChallenge } : null),
      ...(data.codeChallengeMethod
        ? { codeChallengeMethod: data.codeChallengeMethod }
        : null),

      scopes: JSON.parse(data.scopes),
      client: {
        ...client,
        scopes: client?.scopes.map((scope) => scope.name)
      },
      user: User.parse({
        id: actor?.id,
        actor: actor?.data,
        account
      }),

      expiresAt: data.expiresAt,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    })
  },

  async revokeAuthCode(params: RevokeAuthCodeParams) {
    const { code } = RevokeAuthCodeParams.parse(params)
    const currentTime = Date.now()
    await database('auth_codes').where('code', code).update({
      expiresAt: currentTime
    })
    return this.getAuthCode({ code })
  }
})
