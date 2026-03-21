import { oauthProvider } from '@better-auth/oauth-provider'
import bcrypt from 'bcrypt'
import { betterAuth } from 'better-auth'
import { jwt } from 'better-auth/plugins'
import memoize from 'lodash/memoize'

import { getBaseURL, getConfig } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { logger } from '@/lib/utils/logger'

import { knexAdapter } from './knexAdapter'

export const AUTH_COOKIE_PREFIX = 'better-auth'
export const AUTH_SESSION_COOKIE_NAME = 'session_token'

export const getAuth = memoize(() => {
  const config = getConfig()
  const database = getDatabase()
  const db = getKnex()

  const baseURL = getBaseURL()

  return betterAuth({
    logger: {
      level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn'
    },
    secret: config.secretPhase,
    baseURL,
    basePath: '/api/auth',
    database: knexAdapter(db),
    disabledPaths: ['/token'], // Disable jwt plugin's /api/auth/token;
    // OAuth tokens are issued via oauthProvider. JWKS stays enabled for OAuthGuard.
    plugins: [
      jwt(),
      oauthProvider({
        loginPage: '/auth/signin',
        consentPage: '/oauth/authorize',
        scopes: ['read', 'write', 'follow', 'push'],
        accessTokenExpiresIn: 7 * 24 * 60 * 60,
        refreshTokenExpiresIn: 30 * 24 * 60 * 60,
        codeExpiresIn: 10 * 60,
        grantTypes: [
          'authorization_code',
          'client_credentials',
          'refresh_token'
        ],
        allowDynamicClientRegistration: false,
        postLogin: {
          page: '/oauth/authorize',
          // Consent is handled at /oauth/authorize; no additional redirect needed
          shouldRedirect: async () => false,
          consentReferenceId: async ({ session }) => {
            const actorId = (session as Record<string, unknown>)?.actorId as
              | string
              | undefined
            if (actorId) return actorId
            if (!database || !session?.userId) return undefined
            try {
              const account = await database.getAccountFromId({
                id: session.userId as string
              })
              return account?.defaultActorId ?? undefined
            } catch (e) {
              logger.error({
                message: 'Failed to load account in consentReferenceId',
                error: e
              })
              return undefined
            }
          }
        },
        customAccessTokenClaims: async ({ referenceId }) => {
          return { actorId: referenceId ?? null }
        }
      })
    ],
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
      storeSessionInDatabase: true,
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
            let account
            try {
              account = await database.getAccountFromId({ id: session.userId })
            } catch (e) {
              logger.error({
                message: 'Failed to load account in session hook',
                error: e
              })
              return false
            }
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
