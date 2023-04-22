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
    async createUser({ email }) {
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

      return userFromAccount(account)
    },
    async getUserByAccount(providerAccountId) {
      throw NoImplementationError
    },
    async updateUser(user) {
      throw NoImplementationError
    },
    async deleteUser(userId) {
      throw NoImplementationError
    },
    async linkAccount(account) {
      throw NoImplementationError
    },
    async unlinkAccount(accountId) {
      throw NoImplementationError
    },
    async createSession(session) {
      throw NoImplementationError
    },
    async getSessionAndUser(sessionToken) {
      throw NoImplementationError
    },
    async updateSession(session) {
      throw NoImplementationError
    },
    async deleteSession(sessionToken) {
      throw NoImplementationError
    },
    async createVerificationToken(verificationToken) {
      throw NoImplementationError
    },
    async useVerificationToken(params) {
      throw NoImplementationError
    }
  }
}
