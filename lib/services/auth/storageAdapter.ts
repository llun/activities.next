import { Adapter } from 'next-auth/adapters'
import { JWT, decode } from 'next-auth/jwt'

import { Account } from '../../models/account'
import { getStorage } from '../../storage'

const NoImplementationError = new Error('No implmentation')

export const userFromAccount = (account: Account) => ({
  id: account.id,
  email: account.email,
  emailVerified: new Date(account.createdAt)
})

export function StorageAdapter(secret: string): Adapter {
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async updateUser(user) {
      throw NoImplementationError
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      if (accountAndSession) {
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
      }

      try {
        const accountFromJWT = await decode({ token: sessionToken, secret })
        const decodedJWT = accountFromJWT as JWT & {
          jti: string
          exp: number
          iat: number
        }
        if (!decodedJWT?.email) return null
        const actor = await storage.getActorFromEmail({
          email: decodedJWT.email
        })
        if (!actor || !actor.account) return null

        return {
          session: {
            sessionToken,
            expires: new Date(decodedJWT.exp * 1000),
            userId: actor.account.id
          },
          user: {
            email: decodedJWT.email,
            emailVerified: new Date(actor.account.createdAt),
            id: actor.account.id
          }
        }
      } catch {
        return null
      }
    },
    async updateSession(session) {
      const { sessionToken, expires } = session
      const storage = await getStorage()
      if (!storage) return null

      await storage.updateAccountSession({
        token: sessionToken,
        expireAt: expires?.getTime()
      })
      const accountAndSession = await storage.getAccountSession({
        token: sessionToken
      })
      if (!accountAndSession) return null
      return {
        sessionToken,
        expires: new Date(accountAndSession.session.expireAt),
        userId: accountAndSession.account.id
      }
    },
    async deleteSession(sessionToken) {
      const storage = await getStorage()
      if (!storage) return

      await storage.deleteAccountSession({ token: sessionToken })
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async createVerificationToken(verificationToken) {
      throw NoImplementationError
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async useVerificationToken(params) {
      throw NoImplementationError
    }
  }
}
