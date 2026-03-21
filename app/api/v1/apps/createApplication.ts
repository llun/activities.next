import crypto from 'crypto'

import { getKnex } from '@/lib/database'
import { Database } from '@/lib/database/types'
import { Scope } from '@/lib/types/database/operations'
import { getTracer } from '@/lib/utils/trace'

import {
  ErrorResponse,
  PostRequest,
  PostResponse,
  SuccessResponse
} from './types'

const hashClientSecret = async (secret: string): Promise<string> => {
  const hash = crypto.createHash('sha256').update(secret).digest()
  return hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

const generateRandomString = (length: number): string => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  const bytes = crypto.randomBytes(length)
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}

export const createApplication = async (
  database: Database,
  request: PostRequest
): Promise<PostResponse> => {
  return getTracer().startActiveSpan(
    'createApplication',
    { attributes: { clientName: request.client_name, scopes: request.scopes } },
    async (span) => {
      const scopes = request.scopes ?? Scope.enum.read
      const db = getKnex()

      try {
        const existingClient = await database.getClientFromName({
          name: request.client_name
        })

        if (existingClient) {
          // Update the existing client's scopes and redirect URIs
          const parsedScopes = scopes
            .split(' ')
            .map((scope) => Scope.parse(scope))
          const redirectUris = request.redirect_uris
            .split(' ')
            .map((uri) => uri.trim())

          // Generate a new secret since we can't retrieve the hashed one
          const newSecret = generateRandomString(32)
          const hashedSecret = await hashClientSecret(newSecret)

          await db('oauthClient')
            .where('clientId', existingClient.clientId)
            .update({
              scopes: JSON.stringify(parsedScopes),
              redirectUris: JSON.stringify(redirectUris),
              clientSecret: hashedSecret,
              updatedAt: new Date()
            })

          return SuccessResponse.parse({
            type: 'success',
            id: existingClient.clientId,
            client_id: existingClient.clientId,
            client_secret: newSecret,
            name: existingClient.name ?? request.client_name,
            website: existingClient.website ?? undefined,
            redirect_uri: redirectUris[0]
          })
        }

        // Create new client
        const clientId = generateRandomString(32)
        const clientSecret = generateRandomString(32)
        const hashedSecret = await hashClientSecret(clientSecret)
        const parsedScopes = scopes
          .split(' ')
          .map((scope) => Scope.parse(scope))
        const redirectUris = request.redirect_uris.split(' ')
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
