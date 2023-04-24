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

      console.log('createUser =========>', email)

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
      console.log('getUser =====>', id)
      const storage = await getStorage()
      if (!storage) return null

      const account = await storage.getAccountFromId({ id })
      if (!account) return null

      return userFromAccount(account)
    },
    async getUserByEmail(email) {
      console.log('getUserByEmail =====>', email)
      const storage = await getStorage()
      if (!storage) return null

      const actor = await storage?.getActorFromEmail({ email })
      if (!actor) return null

      const account = actor.account
      if (!account) return null

      return userFromAccount(account)
    },
    async getUserByAccount({ provider, providerAccountId }) {
      console.log('getUserByAccount =====>', provider, providerAccountId)
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
      console.log('Update User =====>', user)
      throw NoImplementationError
    },
    async deleteUser(userId) {
      console.log('Delete User =====>', userId)
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
      console.log('Unlink account =====>', accountId)
      throw NoImplementationError
    },
    async createSession(session) {
      console.log('Create Session ======> ', session)
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
      console.log('Get session and user =====>', sessionToken)
      throw NoImplementationError
    },
    async updateSession(session) {
      console.log('Update session =====>', session)
      throw NoImplementationError
    },
    async deleteSession(sessionToken) {
      console.log('Delete session =====>', sessionToken)
      throw NoImplementationError
    },
    async createVerificationToken(verificationToken) {
      console.log('Create verification token =====>', verificationToken)
      throw NoImplementationError
    },
    async useVerificationToken(params) {
      console.log('Use verification token =====>', params)
      throw NoImplementationError
    }
  }
}
