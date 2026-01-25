import bcrypt from 'bcrypt'
import { memoize } from 'lodash'
import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GithubProvider from 'next-auth/providers/github'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import {
  StorageAdapter,
  userFromAccount
} from '@/lib/services/auth/storageAdapter'

export const getAuthOptions = memoize(() => {
  try {
    const { secretPhase, auth, serviceName } = getConfig()
    return {
      secret: secretPhase,
      session: {
        strategy: 'database'
      },
      providers: [
        CredentialsProvider({
          name: serviceName ?? 'credentials',
          credentials: {
            email: { label: 'Email', type: 'email' },
            password: { label: 'Password', type: 'password' }
          },
          async authorize(credentials, _request) {
            if (!credentials) return null

            const database = getDatabase()
            const { email, password } = credentials

            // Get account by email
            const account = await database?.getAccountFromEmail({ email })
            if (!account) return null
            if (!account?.passwordHash) return null
            if (!account.verifiedAt) return null

            const isPasswordCorrect = await bcrypt.compare(
              password,
              account.passwordHash
            )

            if (!isPasswordCorrect) return null
            return userFromAccount(account)
          }
        }),
        GithubProvider({
          clientId: auth?.github?.id || '',
          clientSecret: auth?.github?.secret || ''
        })
      ],
      pages: {
        signIn: '/auth/signin'
      },
      callbacks: {
        async signIn({ user, account: providerAccount }) {
          const database = getDatabase()
          if (!database) return false

          // For credentials sign-in, verify the local account
          if (providerAccount?.type === 'credentials') {
            const account = await database.getAccountFromId({ id: user.id })
            if (!account?.verifiedAt) return false
            return true
          }

          // For OAuth sign-in (e.g., GitHub linking from settings page)
          if (
            providerAccount?.type === 'oauth' &&
            providerAccount.providerAccountId
          ) {
            // Check if this GitHub account is already linked
            const linkedAccount = await database.getAccountFromProviderId({
              provider: providerAccount.provider,
              accountId: providerAccount.providerAccountId
            })

            // If already linked, verify the linked account is verified
            if (linkedAccount) {
              if (!linkedAccount.verifiedAt) return false
              return true
            }

            // Try to find user by OAuth email (for users who have matching emails)
            if (user.email) {
              const actor = await database.getActorFromEmail({
                email: user.email
              })
              if (actor?.account?.verifiedAt) {
                return true
              }
            }

            // For account linking from settings page where emails don't match,
            // we allow the sign-in to proceed. The linkAccount adapter method
            // will be called with the current session's userId to link the accounts.
            // We return true here to allow the OAuth flow to complete.
            return true
          }

          return false
        }
      },
      adapter: StorageAdapter(secretPhase)
    } as NextAuthOptions
  } catch {
    return {} as NextAuthOptions
  }
})
