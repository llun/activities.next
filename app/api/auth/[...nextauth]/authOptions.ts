import bcrypt from 'bcrypt'
import { memoize } from 'lodash'
import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GithubProvider from 'next-auth/providers/github'

import { getConfig } from '@/lib/config'
import {
  StorageAdapter,
  userFromAccount
} from '@/lib/services/auth/storageAdapter'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getStorage } from '@/lib/storage'

export const getAuthOptions = memoize(() => {
  try {
    const { secretPhase, auth, serviceName } = getConfig()
    return {
      session: {
        strategy: 'database'
      },
      providers: [
        CredentialsProvider({
          name: serviceName ?? 'credentials',
          credentials: {
            actorId: { label: 'Actor Address', type: 'text' },
            password: { label: 'Password', type: 'password' }
          },
          async authorize(credentials, request) {
            const hostname = headerHost(request.headers)
            if (!credentials) return null

            const storage = await getStorage()
            const { actorId, password } = credentials
            const [username, domain] = actorId.split('@')
            const actor = await storage?.getActorFromUsername({
              username,
              domain: domain ?? hostname
            })
            if (!actor) return null

            const account = actor.account
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
        async signIn({ user }) {
          const storage = await getStorage()
          if (!storage) return false

          const account = await storage.getAccountFromId({ id: user.id })
          if (!account?.verifiedAt) return false

          return true
        }
      },
      adapter: StorageAdapter(secretPhase)
    } as NextAuthOptions
  } catch {
    return {} as NextAuthOptions
  }
})
