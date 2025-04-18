import { Firestore } from '@google-cloud/firestore'

import {
  AccountDatabase,
  CreateAccountParams,
  CreateAccountSessionParams,
  DeleteAccountSessionParams,
  GetAccountAllSessionsParams,
  GetAccountFromIdParams,
  GetAccountFromProviderIdParams,
  GetAccountSessionParams,
  IsAccountExistsParams,
  IsUsernameExistsParams,
  LinkAccountWithProviderParams,
  UpdateAccountSessionParams,
  VerifyAccountParams
} from '@/lib/database/types/account'
import { Account } from '@/lib/models/account'
import { Session } from '@/lib/models/session'
import { urlToId } from '@/lib/utils/urlToId'

export const AccountFirestoreDatabaseMixin = (
  firestore: Firestore
): AccountDatabase => ({
  async isAccountExists({ email }: IsAccountExistsParams) {
    const accounts = firestore.collection('accounts')
    const snapshot = await accounts.where('email', '==', email).count().get()
    return snapshot.data().count === 1
  },

  async isUsernameExists({ username, domain }: IsUsernameExistsParams) {
    const accounts = firestore.collection('actors')
    const snapshot = await accounts
      .where('username', '==', username)
      .where('domain', '==', domain)
      .count()
      .get()
    return snapshot.data().count === 1
  },

  async createAccount({
    email,
    username,
    passwordHash,
    verificationCode,
    domain,
    privateKey,
    publicKey
  }: CreateAccountParams) {
    const actorId = `https://${domain}/users/${username}`
    if (await this.isAccountExists({ email })) {
      throw new Error('Account already exists')
    }

    const currentTime = Date.now()
    const accounts = firestore.collection('accounts')
    const accountRef = await accounts.add({
      email,
      passwordHash,
      ...(verificationCode
        ? { verificationCode }
        : { verifiedAt: currentTime }),
      createdAt: currentTime,
      updatedAt: currentTime
    })

    const actorDoc = {
      id: actorId,
      accountId: accountRef.id,

      username,
      domain,
      name: '',
      summary: '',

      iconUrl: '',
      headerImageUrl: '',

      followersUrl: `${actorId}/followers`,
      inboxUrl: `${actorId}/inbox`,
      sharedInboxUrl: `https://${domain}/inbox`,

      publicKey,
      privateKey,

      followingCount: 0,
      followersCount: 0,
      statusCount: 0,

      createdAt: currentTime,
      updatedAt: currentTime
    }

    await firestore.doc(`actors/${urlToId(actorId)}`).set(actorDoc)
    return accountRef.id
  },

  async getAccountFromId({ id }: GetAccountFromIdParams) {
    const accounts = firestore.collection('accounts')
    const snapshot = await accounts.doc(id).get()
    if (!snapshot) return null
    return {
      ...snapshot.data(),
      id
    } as Account
  },

  async getAccountFromProviderId({
    provider,
    accountId
  }: GetAccountFromProviderIdParams) {
    const providers = await firestore
      .collectionGroup('accountProviders')
      .where('provider', '==', provider)
      .where('providerAccountId', '==', accountId)
      .get()
    if (providers.size !== 1) return null

    const providerDoc = providers.docs[0]
    return this.getAccountFromId({
      id: providerDoc.data().accountId
    })
  },

  async linkAccountWithProvider({
    accountId,
    providerAccountId,
    provider
  }: LinkAccountWithProviderParams) {
    const providers = await firestore
      .collectionGroup('accountProviders')
      .where('provider', '==', provider)
      .where('accountId', '==', accountId)
      .get()
    if (providers.size === 1) return null

    const account = await firestore.doc(`accounts/${accountId}`).get()
    if (!account.exists) return null

    const currentTime = Date.now()
    await firestore
      .doc(`accounts/${accountId}/accountProviders/${provider}`)
      .set({
        ...account.data(),
        provider,
        providerAccountId,
        updatedAt: currentTime
      })
    return this.getAccountFromId({ id: accountId })
  },

  async verifyAccount({ verificationCode }: VerifyAccountParams) {
    const accounts = firestore.collection('accounts')
    const snapshot = await accounts
      .where('verificationCode', '==', verificationCode)
      .get()
    if (snapshot.docs.length !== 1) return null

    const currentTime = Date.now()
    await Promise.all(
      snapshot.docs.map((doc) =>
        doc.ref.update({
          verificationCode: '',
          updatedAt: currentTime,
          verifiedAt: currentTime
        })
      )
    )

    return this.getAccountFromId({ id: snapshot.docs[0].data().id })
  },

  async createAccountSession({
    accountId,
    expireAt,
    token
  }: CreateAccountSessionParams): Promise<void> {
    const currentTime = Date.now()
    await firestore.doc(`accounts/${accountId}/sessions/${token}`).set({
      accountId,
      token,
      expireAt,
      createdAt: currentTime,
      updatedAt: currentTime
    })
  },

  async getAccountSession({ token }: GetAccountSessionParams): Promise<{
    account: Account
    session: Session
  } | null> {
    const tokenDocs = await firestore
      .collectionGroup('sessions')
      .where('token', '==', token)
      .get()
    if (tokenDocs.size !== 1) return null

    const session = Session.parse(tokenDocs.docs[0].data())
    const account = await this.getAccountFromId({ id: session.accountId })
    if (!account) return null

    return { account, session }
  },

  async getAccountAllSessions({
    accountId
  }: GetAccountAllSessionsParams): Promise<Session[]> {
    const sessionDocs = await firestore
      .collection(`accounts/${accountId}/sessions`)
      .get()
    return sessionDocs.docs.map((doc) => Session.parse(doc.data()))
  },

  async updateAccountSession({
    token,
    expireAt
  }: UpdateAccountSessionParams): Promise<void> {
    if (!expireAt) return

    const sessionDocs = await firestore
      .collectionGroup('sessions')
      .where('token', '==', token)
      .get()
    await Promise.all(
      sessionDocs.docs.map((doc) => doc.ref.update({ expireAt }))
    )
  },

  async deleteAccountSession({
    token
  }: DeleteAccountSessionParams): Promise<void> {
    const sessions = await firestore
      .collectionGroup('sessions')
      .where('token', '==', token)
      .get()

    await Promise.all(sessions.docs.map((doc) => doc.ref.delete()))
  }
})
