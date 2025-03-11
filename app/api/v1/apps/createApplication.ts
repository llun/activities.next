import crypto from 'crypto'

import { Database } from '@/lib/database/types'
import { Scope } from '@/lib/database/types/oauth'
import { getTracer } from '@/lib/utils/trace'

import {
  ErrorResponse,
  PostRequest,
  PostResponse,
  SuccessResponse
} from './types'

export const createApplication = async (
  database: Database,
  request: PostRequest
): Promise<PostResponse> => {
  return getTracer().startActiveSpan(
    'createApplication',
    { attributes: { clientName: request.client_name, scopes: request.scopes } },
    async (span) => {
      const scopes = request.scopes ?? Scope.enum.read
      try {
        const existingApplication = await database.getClientFromName({
          name: request.client_name
        })
        if (existingApplication) {
          await database.updateClient({
            ...existingApplication,
            scopes: scopes.split(' ').map((scope) => Scope.parse(scope)),
            redirectUris: request.redirect_uris
              .split(' ')
              .map((uri) => uri.trim())
          })
          return SuccessResponse.parse({
            type: 'success',
            id: existingApplication.id,
            client_id: existingApplication.id,
            client_secret: existingApplication.secret,
            name: existingApplication.name,
            website: existingApplication.website,
            redirect_uri: existingApplication.redirectUris[0]
          })
        }

        const application = await database.createClient({
          name: request.client_name,
          redirectUris: request.redirect_uris.split(' '),
          scopes: scopes.split(' ').map((scope) => Scope.parse(scope)),
          secret: crypto.randomBytes(16).toString('hex'),
          website: request.website
        })
        if (!application) {
          return ErrorResponse.parse({
            type: 'error',
            error: 'Failed to create application'
          })
        }
        return SuccessResponse.parse({
          type: 'success',
          id: application.id,
          client_id: application.id,
          client_secret: application.secret,
          name: application.name,
          website: application.website,
          redirect_uri: application.redirectUris[0]
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
