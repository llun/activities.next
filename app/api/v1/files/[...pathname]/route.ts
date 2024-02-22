import { NextRequest } from 'next/server'
import path from 'path'

import { apiErrorResponse } from '@/lib/errors'
import { AppRouterParams } from '@/lib/services/guards/types'
import { getMedia } from '@/lib/services/medias'

interface Params {
  pathname: string
}

export const GET = async (
  req: NextRequest,
  params: AppRouterParams<Params>
) => {
  const { pathname } = params.params
  const userPath = path
    .normalize(Array.isArray(pathname) ? pathname.join('/') : pathname)
    .replace(/^(\.\.(\/|\\|$))+/, '')

  const media = await getMedia(userPath)
  if (!media) return apiErrorResponse(404)

  switch (media.type) {
    case 'buffer': {
      const { contentType, buffer } = media
      const headers = new Headers([
        ['Content-Type', contentType],
        // Make media cache for 1 year
        ['Cache-Control', 'public, max-age=31536000, immutable']
      ])
      return new Response(buffer, { headers })
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
