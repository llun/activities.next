import { NextRequest } from 'next/server'
import path from 'path'

import { ERROR_404 } from '../../../../../lib/errors'
import { AppRouterParams } from '../../../../../lib/guard'
import { getMedia } from '../../../../../lib/services/medias'

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
  if (!media) {
    return Response.json(ERROR_404, { status: 404 })
  }

  const { contentType, buffer } = media
  const headers = new Headers([
    ['Content-Type', contentType],
    // Make media cache for 1 year
    ['Cache-Control', 'public, max-age=31536000, immutable']
  ])
  return new Response(buffer, { headers })
}
