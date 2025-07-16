import * as bcrypt from 'bcrypt'
import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GithubProvider from 'next-auth/providers/github'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import {
  StorageAdapter,
  userFromAccount
} from '@/lib/services/auth/storageAdapter'
import { headerHost } from '@/lib/services/guards/headerHost'

const getAuthConfig = () => {
  try {
    const { secretPhase, auth, serviceName } = getConfig()
    
    if (!secretPhase) {
      console.error('Secret phase is not configured')
      throw new Error('Secret phase is not configured')
    }
    
    const providers = [
      CredentialsProvider({
        name: serviceName ?? 'credentials',
        credentials: {
          actorId: { label: 'Actor Address', type: 'text' },
          password: { label: 'Password', type: 'password' }
        },
        async authorize(credentials, request) {
          try {
            const hostname = headerHost(request.headers)
            if (!credentials) return null

            const database = getDatabase()
            if (!database) return null

            const { actorId, password } = credentials
            const [username, domain] = (actorId as string).split('@')
            const actor = await database.getActorFromUsername({
              username,
              domain: domain ?? hostname
            })
            if (!actor) return null

            const account = actor.account
            if (!account?.passwordHash) return null
            if (!account.verifiedAt) return null

            const isPasswordCorrect = await bcrypt.compare(
              password as string,
              account.passwordHash
            )

            if (!isPasswordCorrect) return null
            return userFromAccount(account)
          } catch (error) {
            console.error('Authorization error:', error)
            return null
          }
        }
      })
    ] as any[]

    // Only add GitHub provider if configured
    if (auth?.github?.id && auth?.github?.secret) {
      providers.push(
        GithubProvider({
          clientId: auth.github.id,
          clientSecret: auth.github.secret
        })
      )
    }

    const config = {
      trustHost: true,
      session: {
        strategy: 'database' as const
      },
      providers,
      pages: {
        signIn: '/auth/signin'
      },
      callbacks: {
        async signIn({ user }: { user: any }) {
          try {
            const database = getDatabase()
            if (!database) return false

            const account = await database.getAccountFromId({ id: user.id })
            if (!account?.verifiedAt) return false

            return true
          } catch (error) {
            console.error('SignIn callback error:', error)
            return false
          }
        }
      },
      adapter: StorageAdapter(secretPhase)
    }

    return config
  } catch (error) {
    console.error('Auth config error:', error)
    return {
      providers: [
        CredentialsProvider({
          name: 'credentials',
          credentials: {
            actorId: { label: 'Actor Address', type: 'text' },
            password: { label: 'Password', type: 'password' }
          },
          async authorize() {
            return null
          }
        })
      ],
      session: {
        strategy: 'database' as const
      },
      trustHost: true
    }
  }
}

export const { auth, handlers, signIn, signOut } = NextAuth(getAuthConfig())