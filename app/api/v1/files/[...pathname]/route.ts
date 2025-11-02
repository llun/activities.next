import { NextRequest } from 'next/server'
import path from 'path'

import { getDatabase } from '@/lib/database'
import { getMedia } from '@/lib/services/medias'
import { apiErrorResponse } from '@/lib/utils/response'

interface Params {
  pathname: string[]
}

export const GET = async (
  req: NextRequest,
  context: { params: Promise<Params> }
) => {
  const { pathname } = await context.params
  const userPath = path
    .normalize(Array.isArray(pathname) ? pathname.join('/') : pathname)
    .replace(/^(\.\.(\/|\\|$))+/, '')
  const database = getDatabase()
  if (!database) {
    return apiErrorResponse(500)
  }

  const media = await getMedia(database, userPath)
  if (!media) return apiErrorResponse(404)

  switch (media.type) {
    case 'buffer': {
      const { contentType, buffer } = media
      const headers = new Headers([
        ['Content-Type', contentType],
        // Make media cache for 1 year
        ['Cache-Control', 'public, max-age=31536000, immutable']
      ])
      // Buffer extends Uint8Array which is valid BodyInit, but TypeScript needs assertion
      return new Response(buffer as BodyInit, { headers })
    }
    case 'redirect': {
      const { redirectUrl } = media
      return Response.redirect(redirectUrl, 308)
    }
    default: {
      return apiErrorResponse(404)
    }
  }
}
