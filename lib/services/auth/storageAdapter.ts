import { Adapter, AdapterAccount, AdapterUser } from 'next-auth/adapters'
import { JWT, decode } from 'next-auth/jwt'

import { getDatabase } from '@/lib/database'
import { Account } from '@/lib/models/account'

const NoImplementationError = new Error('No implmentation')

export const userFromAccount = (account: Account) => ({
  id: account.id,
  email: account.email,
  emailVerified: new Date(account.createdAt)
})

export function StorageAdapter(secret: string): Adapter {
  return {
    async createUser(user: AdapterUser) {
      const { email } = user
      const database = getDatabase()
      const actor = await database?.getActorFromEmail({ email })
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
      const database = getDatabase()
      const account = await database?.getAccountFromId({ id })
      if (!account) return null

      return userFromAccount(account)
    },
    async getUserByEmail(email) {
      const database = getDatabase()
      const actor = await database?.getActorFromEmail({ email })
      if (!actor) return null

      const account = actor.account
      if (!account) return null

      return userFromAccount(account)
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const database = getDatabase()
      const account = await database?.getAccountFromProviderId({
        provider,
        accountId: providerAccountId
      })
      if (!account) return null
      return userFromAccount(account)
    },
    async updateUser(/* user */) {
      throw NoImplementationError
    },
    async deleteUser(/* userId */) {
      throw NoImplementationError
    },
    async linkAccount({ provider, providerAccountId, userId }: AdapterAccount) {
      const database = getDatabase()
      await database?.linkAccountWithProvider({
        accountId: userId,
        provider,
        providerAccountId
      })
    },
    async unlinkAccount(/* accountId */) {
      throw NoImplementationError
    },
    async createSession(session) {
      const { sessionToken, userId, expires } = session
      const database = getDatabase()
      const account = await database?.getAccountFromId({ id: userId })
      await database?.createAccountSession({
        accountId: userId,
        token: sessionToken,
        expireAt: expires instanceof Date ? expires.getTime() : expires,
        actorId: account?.defaultActorId || null
      })
      return session
    },
    async getSessionAndUser(sessionToken) {
      const database = getDatabase()
      const accountAndSession = await database?.getAccountSession({
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
        const actor = await database?.getActorFromEmail({
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
      const database = getDatabase()
      if (!database) return null

      await database.updateAccountSession({
        token: sessionToken,
        expireAt: expires instanceof Date ? expires.getTime() : expires
      })
      const accountAndSession = await database.getAccountSession({
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
      const database = getDatabase()
      await database?.deleteAccountSession({ token: sessionToken })
    },
    async createVerificationToken(/* verificationToken */) {
      throw NoImplementationError
    },
    async useVerificationToken(/* params */) {
      throw NoImplementationError
    }
  }
}
