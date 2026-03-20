import bcrypt from 'bcrypt'
import { betterAuth } from 'better-auth'
import knex from 'knex'
import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'

import { knexAdapter } from './knexAdapter'

export const getAuth = memoize(() => {
  const config = getConfig()
  const database = getDatabase()
  const db = knex(config.database)

  return betterAuth({
    logger: { level: 'debug' },
    secret: config.secretPhase,
    baseURL: config.host.startsWith('http')
      ? config.host
      : `https://${config.host}`,
    basePath: '/api/auth',
    database: knexAdapter(db),
    emailAndPassword: {
      enabled: true,
      password: {
        hash: (password: string) => bcrypt.hash(password, 10),
        verify: ({ hash, password }: { hash: string; password: string }) =>
          bcrypt.compare(password, hash)
      }
    },
    socialProviders: {
      github: config.auth?.github
        ? {
            clientId: config.auth.github.id,
            clientSecret: config.auth.github.secret
          }
        : undefined
    },
    account: {
      modelName: 'account_providers',
      accountLinking: {
        enabled: true
      },
      fields: {
        userId: 'accountId',
        providerId: 'provider',
        accountId: 'providerId'
      }
    },
    user: {
      modelName: 'accounts',
      fields: {
        email: 'email',
        emailVerified: 'emailVerified',
        name: 'name',
        image: 'image'
      }
    },
    session: {
      modelName: 'sessions',
      fields: {
        userId: 'accountId',
        token: 'token',
        expiresAt: 'expireAt'
      }
    },
    pages: {
      signIn: '/auth/signin'
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            if (!database) return
            const account = await database.getAccountFromId({
              id: session.userId
            })
            return {
              data: {
                ...session,
                actorId: account?.defaultActorId || null
              }
            }
          }
        }
      }
    }
  })
})
