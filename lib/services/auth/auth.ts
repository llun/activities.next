import bcrypt from 'bcrypt'
import { betterAuth } from 'better-auth'
import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'

import { knexAdapter } from './knexAdapter'

export const AUTH_COOKIE_PREFIX = 'better-auth'
export const AUTH_SESSION_COOKIE_NAME = 'session_token'

export const getAuth = memoize(() => {
  const config = getConfig()
  const database = getDatabase()
  const db = getKnex()

  return betterAuth({
    logger: {
      level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn'
    },
    secret: config.secretPhase,
    baseURL: config.host.startsWith('http')
      ? config.host
      : `${process.env.NODE_ENV === 'development' ? 'http' : 'https'}://${config.host}`,
    basePath: '/api/auth',
    database: knexAdapter(db),
    emailAndPassword: {
      enabled: config.auth?.enableCredential !== false,
      disableSignUp: true,
      requireEmailVerification: true,
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
            clientSecret: config.auth.github.secret,
            disableSignUp: true
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
      },
      additionalFields: {
        actorId: {
          type: 'string',
          required: false
        }
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
            if (!account) return false
            if (!account.verifiedAt) return false
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
