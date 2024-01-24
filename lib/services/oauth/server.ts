import { OAuth2Server } from '@node-oauth/oauth2-server'
import { memoize } from 'lodash'

export const getOAuthServer = memoize(() => {
  return new OAuth2Server({
    model: {
      async getAccessToken() {
        throw new Error('No implementation')
      },

      async getAuthorizationCode() {
        throw new Error('No implementation')
      },

      async saveToken() {
        throw new Error('No implementation')
      },

      async getClient() {
        throw new Error('No implementation')
      },

      async getUser() {
        throw new Error('No implementation')
      }
    }
  })
})
