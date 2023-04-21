import { Adapter } from 'next-auth/adapters'

import { Storage } from '../../storage/types'

const NoImplementationError = new Error('No implmentation')

export function StorageAdapter(storage: Storage): Adapter {
  return {
    async createUser(user) {
      throw NoImplementationError
    },
    async getUser(id) {
      throw NoImplementationError
    },
    async getUserByEmail(email) {
      throw NoImplementationError
    },
    async getUserByAccount(providerAccountId) {
      throw NoImplementationError
    },
    async updateUser(user) {
      throw NoImplementationError
    },
    async deleteUser(userId) {
      throw NoImplementationError
    },
    async linkAccount(account) {
      throw NoImplementationError
    },
    async unlinkAccount(accountId) {
      throw NoImplementationError
    },
    async createSession(session) {
      throw NoImplementationError
    },
    async getSessionAndUser(sessionToken) {
      throw NoImplementationError
    },
    async updateSession(session) {
      throw NoImplementationError
    },
    async deleteSession(sessionToken) {
      throw NoImplementationError
    },
    async createVerificationToken(verificationToken) {
      throw NoImplementationError
    },
    async useVerificationToken(params) {
      throw NoImplementationError
    }
  }
}
