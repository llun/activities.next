import NextAuth, { NextAuthOptions } from 'next-auth'
import GithubProvider from 'next-auth/providers/github'
import { getConfig } from '../../../lib/config'

export const authOptions: NextAuthOptions = {
  providers: [
    GithubProvider({
      clientId: getConfig().auth?.github?.id || '',
      clientSecret: getConfig().auth?.github?.secret || ''
    })
  ]
}
export default NextAuth(authOptions)
