import { Adapter } from 'better-auth'
import bcrypt from 'bcrypt'

import { getDatabase } from '@/lib/database'

// Custom adapter that maps Better Auth's interface to our existing database schema
export function databaseAdapter(): Adapter {
  return {
    id: 'custom-activities-adapter',
    async create({ model, data }) {
      const database = getDatabase()
      if (!database) throw new Error('Database not available')

      if (model === 'user') {
        // Create account in our schema
        const accountId = crypto.randomUUID()
        const currentTime = Date.now()
        
        await database.query('accounts').insert({
          id: accountId,
          email: data.email,
          passwordHash: data.password ? await bcrypt.hash(data.password, 10) : null,
          emailVerified: data.emailVerified ? currentTime : null,
          verifiedAt: data.emailVerified ? currentTime : null,
          createdAt: currentTime,
          updatedAt: currentTime
        })

        return {
          id: accountId,
          email: data.email,
          emailVerified: data.emailVerified || null,
          createdAt: new Date(currentTime),
          updatedAt: new Date(currentTime)
        }
      }

      if (model === 'session') {
        // Create session in our schema
        const sessionId = crypto.randomUUID()
        const currentTime = Date.now()

        await database.query('sessions').insert({
          id: sessionId,
          accountId: data.userId,
          token: data.token,
          expireAt: data.expiresAt instanceof Date ? data.expiresAt.getTime() : data.expiresAt,
          actorId: null,
          createdAt: currentTime,
          updatedAt: currentTime
        })

        return {
          id: sessionId,
          userId: data.userId,
          token: data.token,
          expiresAt: data.expiresAt instanceof Date ? data.expiresAt : new Date(data.expiresAt),
          createdAt: new Date(currentTime),
          updatedAt: new Date(currentTime)
        }
      }

      if (model === 'account') {
        // Handle OAuth account linking
        const database = getDatabase()
        await database?.linkAccountWithProvider({
          accountId: data.userId,
          provider: data.providerId,
          providerAccountId: data.accountId
        })

        return {
          id: crypto.randomUUID(),
          userId: data.userId,
          providerId: data.providerId,
          accountId: data.accountId,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      }

      throw new Error(`Unsupported model: ${model}`)
    },

    async findOne({ model, where }) {
      const database = getDatabase()
      if (!database) return null

      if (model === 'user') {
        const emailCondition = where.find((w: { field: string }) => w.field === 'email')
        const idCondition = where.find((w: { field: string }) => w.field === 'id')

        if (emailCondition) {
          const actor = await database.getActorFromEmail({ email: emailCondition.value as string })
          if (!actor?.account) return null

          return {
            id: actor.account.id,
            email: actor.account.email,
            emailVerified: actor.account.verifiedAt ? new Date(actor.account.verifiedAt) : null,
            createdAt: new Date(actor.account.createdAt),
            updatedAt: new Date(actor.account.updatedAt)
          }
        }

        if (idCondition) {
          const account = await database.getAccountFromId({ id: idCondition.value as string })
          if (!account) return null

          return {
            id: account.id,
            email: account.email,
            emailVerified: account.verifiedAt ? new Date(account.verifiedAt) : null,
            createdAt: new Date(account.createdAt),
            updatedAt: new Date(account.updatedAt)
          }
        }
      }

      if (model === 'session') {
        const tokenCondition = where.find((w: { field: string }) => w.field === 'token')
        if (tokenCondition) {
          const result = await database.getAccountSession({ token: tokenCondition.value as string })
          if (!result) return null

          return {
            id: result.session.id,
            userId: result.session.accountId,
            token: result.session.token,
            expiresAt: new Date(result.session.expireAt),
            createdAt: new Date(result.session.createdAt),
            updatedAt: new Date(result.session.updatedAt)
          }
        }
      }

      return null
    },

    async findMany({ model, where, limit }) {
      const database = getDatabase()
      if (!database) return []

      if (model === 'session') {
        const userIdCondition = where?.find((w: { field: string }) => w.field === 'userId')
        if (userIdCondition) {
          const sessions = await database.getAccountAllSessions({ accountId: userIdCondition.value as string })
          return sessions.map(s => ({
            id: s.id,
            userId: s.accountId,
            token: s.token,
            expiresAt: new Date(s.expireAt),
            createdAt: new Date(s.createdAt),
            updatedAt: new Date(s.updatedAt)
          })).slice(0, limit || 100)
        }
      }

      return []
    },

    async update({ model, where, update }) {
      const database = getDatabase()
      if (!database) throw new Error('Database not available')

      if (model === 'session') {
        const tokenCondition = where.find((w: { field: string }) => w.field === 'token')
        if (tokenCondition && update.expiresAt) {
          await database.updateAccountSession({
            token: tokenCondition.value as string,
            expireAt: update.expiresAt instanceof Date ? update.expiresAt.getTime() : update.expiresAt
          })

          const result = await database.getAccountSession({ token: tokenCondition.value as string })
          if (!result) return null

          return {
            id: result.session.id,
            userId: result.session.accountId,
            token: result.session.token,
            expiresAt: new Date(result.session.expireAt),
            createdAt: new Date(result.session.createdAt),
            updatedAt: new Date(result.session.updatedAt)
          }
        }
      }

      if (model === 'user') {
        const idCondition = where.find((w: { field: string }) => w.field === 'id')
        if (idCondition) {
          // Update account details if needed
          const account = await database.getAccountFromId({ id: idCondition.value as string })
          if (!account) return null

          return {
            id: account.id,
            email: account.email,
            emailVerified: account.verifiedAt ? new Date(account.verifiedAt) : null,
            createdAt: new Date(account.createdAt),
            updatedAt: new Date(account.updatedAt)
          }
        }
      }

      return null
    },

    async delete({ model, where }) {
      const database = getDatabase()
      if (!database) return

      if (model === 'session') {
        const tokenCondition = where.find((w: { field: string }) => w.field === 'token')
        if (tokenCondition) {
          await database.deleteAccountSession({ token: tokenCondition.value as string })
        }
      }
    }
  }
}
