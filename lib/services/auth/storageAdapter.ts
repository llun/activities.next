import { Adapter } from 'next-auth/adapters'

import { Account } from '../../models/account'
import { getStorage } from '../../storage'

const NoImplementationError = new Error('No implmentation')

const userFromAccount = (account: Account) => ({
  id: account.id,
  email: account.email,
  emailVerified: new Date(account.createdAt)
})

export function StorageAdapter(): Adapter {
  return {
    async createUser(user) {
      const { email } = user
      const storage = await getStorage()
      const actor = await storage?.getActorFromEmail({ email })
      if (!actor) {
        throw NoImplementationError
      }

      const account = actor.account
      if (!account) {
        throw NoImplementationError
      }

      return userFromAccount(account)
    },
    async getUser(id) {
      const storage = await getStorage()
      if (!storage) return null

      const account = await storage.getAccountFromId({ id })
      if (!account) return null

      return userFromAccount(account)
    },
    async getUserByEmail(email) {
      const storage = await getStorage()
      if (!storage) return null

      const actor = await storage?.getActorFromEmail({ email })
      if (!actor) return null

      const account = actor.account
      if (!account) return null

      return null
      return userFromAccount(account)
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const storage = await getStorage()
      if (!storage) return null

      const account = await storage?.getAccountFromProviderId({
        provider,
        accountId: providerAccountId
      })
      if (!account) return null
      return userFromAccount(account)
    },
    async updateUser(user) {
      throw NoImplementationError
    },
    async deleteUser(userId) {
      throw NoImplementationError
    },
    async linkAccount({ provider, providerAccountId, userId }) {
      const storage = await getStorage()
      if (!storage) return

      await storage.linkAccountWithProvider({
        accountId: userId,
        provider,
        providerAccountId
      })
    },
    async unlinkAccount(accountId) {
      throw NoImplementationError
    },
    async createSession(session) {
      const { sessionToken, userId, expires } = session
      const storage = await getStorage()

      await storage?.createAccountSession({
        accountId: userId,
        token: sessionToken,
        expireAt: expires.getTime()
      })
      return session
    },
    async getSessionAndUser(sessionToken) {
      const storage = await getStorage()
      if (!storage) return null

      const accountAndSession = await storage.getAccountSession({
        token: sessionToken
      })
      if (!accountAndSession) return null

      const { account, session } = accountAndSession
      return {
        session: {
          sessionToken,
          expires: new Date(session.expireAt),
          userId: session.accountId
        },
        user: {
          email: account.email,
          emailVerified: new Date(account.createdAt),
          id: account.id
        }
      }
    },
    async updateSession(session) {
      throw NoImplementationError
    },
    async deleteSession(sessionToken) {
      const storage = await getStorage()
      await storage?.deleteAccountSession({ token: sessionToken })
    },
    async createVerificationToken(verificationToken) {
      throw NoImplementationError
    },
    async useVerificationToken(params) {
      throw NoImplementationError
    }
  }
}
