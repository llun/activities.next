import bcrypt from 'bcrypt'
import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GithubProvider from 'next-auth/providers/github'

import { getConfig } from '@/lib/config'
import {
  StorageAdapter,
  userFromAccount
} from '@/lib/services/auth/storageAdapter'
import { getStorage } from '@/lib/storage'

const { secretPhase, auth, serviceName, host } = getConfig()

export const authOptions: NextAuthOptions = {
  secret: secretPhase,
  providers: [
    CredentialsProvider({
      name: serviceName ?? 'credentials',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials) return null

        const storage = await getStorage()
        const { username, password } = credentials
        const actor = await storage?.getActorFromUsername({
          username,
          domain: host
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
}
