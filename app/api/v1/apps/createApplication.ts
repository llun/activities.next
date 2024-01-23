import crypto from 'crypto'

import { Storage } from '@/lib/storage/types'
import { Scopes } from '@/lib/storage/types/oauth2'

import { PostRequest, PostResponse } from './types'

export const createApplication = async (
  storage: Storage,
  request: PostRequest
): Promise<PostResponse> => {
  const scopes = request.scopes ?? 'read'
  try {
    const application = await storage.createApplication({
      clientName: request.client_name,
      redirectUris: request.redirect_uris.split(' '),
      scopes: scopes.split(' ').map((scope) => Scopes.parse(scope)),
      secret: crypto.randomBytes(16).toString('hex'),
      website: request.website
    })
    if (!application) {
      return {
        type: 'error',
        error: 'Failed to create application'
      }
    }
    return {
      type: 'success',
      id: application.id,
      client_id: application.id,
      client_secret: application.secret,
      name: application.clientName,
      website: application.website,
      redirect_uri: application.redirectUris[0]
    }
  } catch (e) {
    const nodeError = e as NodeJS.ErrnoException
    return {
      type: 'error',
      error: nodeError.message
    }
  }
}
