import crypto from 'crypto'

import { getKnex } from '@/lib/database'
import { Scope } from '@/lib/types/database/operations'
import { getTracer } from '@/lib/utils/trace'

import {
  ErrorResponse,
  PostRequest,
  PostResponse,
  SuccessResponse
} from './types'

const hashClientSecret = (secret: string): string => {
  const hash = crypto.createHash('sha256').update(secret).digest()
  return hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const generateRandomString = (length: number): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const limit = 256 - (256 % chars.length)
  let result = ''
  while (result.length < length) {
    const bytes = crypto.randomBytes(length * 2)
    for (let i = 0; i < bytes.length && result.length < length; i++) {
      if (bytes[i] < limit) {
        result += chars[bytes[i] % chars.length]
      }
    }
  }
  return result
}

export const createApplication = async (
  request: PostRequest
): Promise<PostResponse> => {
  return getTracer().startActiveSpan(
    'createApplication',
    { attributes: { clientName: request.client_name, scopes: request.scopes } },
    async (span) => {
      const scopes = request.scopes ?? Scope.enum.read
      const db = getKnex()

      try {
        // Always create a new client — per the Mastodon API spec, each POST
        // creates a new application with fresh credentials. Silent secret
        // rotation on re-registration would break existing configured clients.
        // Create new client
        const clientId = generateRandomString(32)
        const clientSecret = generateRandomString(32)
        const hashedSecret = hashClientSecret(clientSecret)
        const parsedScopes = scopes
          .split(' ')
          .map((scope) => Scope.parse(scope))
        const redirectUris = request.redirect_uris
          .split(' ')
          .map((uri) => uri.trim())
          .filter(Boolean)
        if (redirectUris.length === 0) {
          return ErrorResponse.parse({
            type: 'error',
            error: 'Failed to validate request'
          })
        }
        for (const uri of redirectUris) {
          try {
            new URL(uri)
          } catch {
            return ErrorResponse.parse({
              type: 'error',
              error: 'Failed to validate request'
            })
          }
        }
        const now = new Date()

        await db('oauthClient').insert({
          id: crypto.randomUUID(),
          clientId,
          clientSecret: hashedSecret,
          name: request.client_name,
          scopes: JSON.stringify(parsedScopes),
          redirectUris: JSON.stringify(redirectUris),
          uri: request.website || null,
          requirePKCE: false,
          disabled: false,
          grantTypes: JSON.stringify([
            'authorization_code',
            'client_credentials',
            'refresh_token'
          ]),
          responseTypes: JSON.stringify(['code']),
          tokenEndpointAuthMethod: 'client_secret_post',
          createdAt: now,
          updatedAt: now
        })

        return SuccessResponse.parse({
          type: 'success',
          id: clientId,
          client_id: clientId,
          client_secret: clientSecret,
          name: request.client_name,
          website: request.website,
          redirect_uri: redirectUris[0]
        })
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        return ErrorResponse.parse({
          type: 'error',
          error: 'Failed to validate request'
        })
      } finally {
        span.end()
      }
    }
  )
}
