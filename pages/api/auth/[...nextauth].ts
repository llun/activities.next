import NextAuth, { NextAuthOptions } from 'next-auth'
import GithubProvider from 'next-auth/providers/github'

import { getConfig } from '../../../lib/config'
import { StorageAdapter } from '../../../lib/services/auth/storageAdapter'

const { secretPhase, auth } = getConfig()

export const authOptions: NextAuthOptions = {
  secret: secretPhase,
  providers: [
    GithubProvider({
      clientId: auth?.github?.id || '',
      clientSecret: auth?.github?.secret || ''
    })
  ],
  pages: {
    signIn: '/auth/signin'
  },
  ...(auth?.enableStorageAdapter ? { adapter: StorageAdapter() } : null)
}
export default NextAuth(authOptions)
