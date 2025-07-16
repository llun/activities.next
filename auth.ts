import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import * as bcrypt from 'bcrypt'

import { getDatabase } from '@/lib/database'

export const { auth, handlers, signIn, signOut } = NextAuth({
  trustHost: true,
  session: {
    strategy: 'jwt'
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        actorId: { label: 'Actor Address', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials, request) {
        if (!credentials?.actorId || !credentials?.password) {
          return null
        }

        const database = getDatabase()
        if (!database) return null

        try {
          const actor = await database.getActorFromEmail({ 
            email: credentials.actorId 
          })
          
          if (!actor?.account?.passwordHash) {
            return null
          }

          const isValid = await bcrypt.compare(
            credentials.password, 
            actor.account.passwordHash
          )
          
          if (!isValid) return null

          return {
            id: actor.account.id,
            email: actor.account.email,
            name: actor.name || actor.username,
            image: actor.avatar
          }
        } catch (error) {
          console.error('Authentication error:', error)
          return null
        }
      }
    })
  ],
  pages: {
    signIn: '/auth/signin'
  }
})

// Export providers for server-side use (serialize to remove functions)
export const getServerProviders = () => [
  {
    id: 'credentials',
    name: 'credentials',
    type: 'credentials'
  }
]