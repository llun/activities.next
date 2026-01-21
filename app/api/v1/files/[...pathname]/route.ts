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
  if (!media) {
    // Return a placeholder image for deleted media
    const placeholderSvg = `
      <svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="400" fill="#f0f0f0"/>
        <text x="50%" y="45%" dominant-baseline="middle" text-anchor="middle" 
              font-family="Arial, sans-serif" font-size="16" fill="#666">
          Media Removed
        </text>
        <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" 
              font-family="Arial, sans-serif" font-size="12" fill="#999">
          This media has been deleted
        </text>
      </svg>
    `
    const headers = new Headers([
      ['Content-Type', 'image/svg+xml'],
      ['Cache-Control', 'public, max-age=3600']
    ])
    return new Response(placeholderSvg, { headers })
  }

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
