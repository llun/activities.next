import { Firestore } from '@google-cloud/firestore'

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
  UpdateClientParams,
  UpdateRefreshTokenParams
} from '@/lib/database/types/oauth'
import { AuthCode } from '@/lib/models/oauth2/authCode'
import { Client } from '@/lib/models/oauth2/client'
import { Token } from '@/lib/models/oauth2/token'
import { User } from '@/lib/models/oauth2/user'

import { AccountDatabase } from '../types/account'
import { ActorDatabase } from '../types/actor'

export const OAuthFirestoreDatabaseMixin = (
  firestore: Firestore,
  actorDatabase: ActorDatabase,
  accountDatabase: AccountDatabase
): OAuthDatabase => ({
  async createClient({
    name,
    redirectUris,
    secret,
    scopes,
    website
  }: CreateClientParams): Promise<Client> {
    const id = crypto.randomUUID()
    const currentTime = Date.now()
    const application = Client.parse({
      id,
      name,
      secret,

      scopes,
      redirectUris,

      ...(website ? { website } : null),

      createdAt: currentTime,
      updatedAt: currentTime
    })

    const existClient = await firestore
      .collection('clients')
      .where('name', '==', name)
      .count()
      .get()
    if (existClient.data().count) {
      throw new Error(`Client ${name} is already exists`)
    }

    await firestore.doc(`clients/${id}`).set({
      ...application,
      scopes: JSON.stringify(scopes),
      redirectUris: JSON.stringify(redirectUris)
    })

    return application
  },

  async getClientFromName({ name }: GetClientFromNameParams) {
    const snapshot = await firestore
      .collection('clients')
      .where('name', '==', name)
      .get()
    if (snapshot.size === 0) return null
    const data = snapshot.docs[0].data()
    return Client.parse({
      ...data,
      scopes: JSON.parse(data.scopes),
      redirectUris: JSON.parse(data.redirectUris)
    })
  },

  async getClientFromId({ clientId }: GetClientFromIdParams) {
    const snapshot = await firestore.doc(`clients/${clientId}`).get()
    if (!snapshot.exists) return null
    const data = snapshot.data()
    if (!data) return null

    return Client.parse({
      ...data,
      scopes: JSON.parse(data.scopes),
      redirectUris: JSON.parse(data.redirectUris)
    })
  },

  async updateClient(params: UpdateClientParams) {
    const { id, name, secret, website, scopes, redirectUris } =
      UpdateClientParams.parse(params)
    const path = `clients/${id}`
    const doc = await firestore.doc(path).get()
    if (!doc.exists) return null

    const currentTime = Date.now()
    const data = doc.data()
    const updatedApplication = Client.parse({
      ...data,
      name,
      secret,

      scopes,
      redirectUris,

      ...(website ? { website } : null),

      updatedAt: currentTime
    })
    await firestore.doc(path).update({
      ...updatedApplication,
      scopes: JSON.stringify(scopes),
      redirectUris: JSON.stringify(redirectUris)
    })
    return updatedApplication
  },

  async getAccessToken({ accessToken }: GetAccessTokenParams) {
    const snapshot = await firestore.doc(`accessTokens/${accessToken}`).get()
    if (!snapshot.exists) return null
    const data = snapshot.data()
    if (!data) return null

    const [client, actor, account] = await Promise.all([
      this.getClientFromId({ clientId: data.clientId }),
      actorDatabase.getActorFromId({ id: data.actorId }),
      accountDatabase.getAccountFromId({ id: data.accountId })
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
    const result = await firestore
      .collection('accessTokens')
      .where('refreshToken', '==', refreshToken)
      .get()
    if (result.size === 0) return null

    const { accessToken } = result.docs[0].data()
    return this.getAccessToken({ accessToken })
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
    const snapshot = await firestore.doc(`accessTokens/${accessToken}`).get()
    if (snapshot.exists) return null

    const actor = await actorDatabase.getActorFromId({ id: actorId })
    if (!actor?.account || actor.account.id !== accountId) return null

    await firestore.doc(`accessTokens/${accessToken}`).set({
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
    })
    return this.getAccessToken({ accessToken })
  },

  async updateRefreshToken(params: UpdateRefreshTokenParams) {
    const { accessToken, refreshToken, refreshTokenExpiresAt } =
      UpdateRefreshTokenParams.parse(params)
    const path = `accessTokens/${accessToken}`

    const [doc, totalRefreshTokens] = await Promise.all([
      firestore.doc(path).get(),
      firestore
        .collection('accessTokens')
        .where('refreshToken', '==', refreshToken)
        .count()
        .get()
    ])

    if (!doc.exists) return null
    if (totalRefreshTokens.data().count !== 0) return null

    await firestore.doc(path).set({
      ...doc.data(),
      refreshToken,
      refreshTokenExpiresAt,

      updatedAt: Date.now()
    })

    return this.getAccessToken({ accessToken })
  },

  async revokeAccessToken(params: RevokeAccessTokenParams) {
    const { accessToken } = RevokeAccessTokenParams.parse(params)
    const path = `accessTokens/${accessToken}`
    const result = await firestore.doc(path).get()
    if (!result.exists) return null

    const currentTime = Date.now()
    await firestore.doc(path).update({
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
    const snapshot = await firestore.doc(`authCodes/${code}`).get()
    if (snapshot.exists) return null

    const actor = await actorDatabase.getActorFromId({ id: actorId })
    if (!actor?.account || actor.account.id !== accountId) return null

    await firestore.doc(`authCodes/${code}`).set({
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
    })
    return this.getAuthCode({ code })
  },

  async getAuthCode(params: GetAuthCodeParams) {
    const { code } = GetAuthCodeParams.parse(params)
    const snapshot = await firestore.doc(`authCodes/${code}`).get()
    if (!snapshot.exists) return null

    const data = snapshot.data()
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
    const path = `authCodes/${code}`
    const result = await firestore.doc(path).get()
    if (!result.exists) return null

    const currentTime = Date.now()
    await firestore.doc(path).update({
      expiresAt: currentTime
    })

    return this.getAuthCode({ code })
  }
})
