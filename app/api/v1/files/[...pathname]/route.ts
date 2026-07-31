import { readFile } from 'fs/promises'
import { NextRequest } from 'next/server'
import path from 'path'

import { getDatabase } from '@/lib/database'
import { getMedia } from '@/lib/services/medias'
import { isReservedFitnessMediaPath } from '@/lib/services/medias/reservedPaths'
import { apiErrorResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  pathname: string[]
}

export const GET = traceApiRoute(
  'getFile',
  async (req: NextRequest, context: { params: Promise<Params> }) => {
    const { pathname } = await context.params
    const normalizedPath = path.normalize(
      Array.isArray(pathname) ? pathname.join('/') : pathname
    )

    // POSIX hosts do not treat Windows drive paths as absolute.
    if (path.isAbsolute(normalizedPath) || /^[a-zA-Z]:/.test(normalizedPath)) {
      return apiErrorResponse(404)
    }

    const userPath = normalizedPath.replace(/^(\.\.(\/|\\|$))+/, '')

    // Fitness uploads live under the media root by default, and this route has
    // no access control and redirects to the public CDN hostname when one is
    // set. Without this it is a way around the owner-only gate on
    // `GET /api/v1/fitness-files/:id`, which serves the same bytes. The match is
    // on a canonical form and a segment boundary, so a legitimate `fitnessed/…`
    // media key is unharmed while the encodings that collapse only later — in
    // the URL parser or at the origin — are caught here.
    if (isReservedFitnessMediaPath(userPath)) {
      return apiErrorResponse(404)
    }

    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const media = await getMedia(database, userPath)
    if (!media) {
      // Return a placeholder image for deleted media
      const placeholderPath = path.join(
        process.cwd(),
        'public',
        'images',
        'media-removed.svg'
      )
      try {
        const placeholderSvg = await readFile(placeholderPath, 'utf-8')
        const headers = new Headers([
          ['Content-Type', 'image/svg+xml'],
          ['Cache-Control', 'public, max-age=3600']
        ])
        return new Response(placeholderSvg, { headers })
      } catch (_error) {
        // Fallback if file can't be read
        return apiErrorResponse(404)
      }
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
        // Re-check at the egress point, on the URL the client will actually
        // follow. The guard above canonicalises the request path, but this is
        // where the WHATWG parser has had its say — so whatever the `Location`
        // ends up addressing is compared once more, and a redirect that resolves
        // into fitness storage never leaves the server. Belt and braces on
        // purpose: the two checks fail independently.
        let redirectPath: string
        try {
          redirectPath = new URL(redirectUrl).pathname
        } catch {
          return apiErrorResponse(404)
        }
        if (isReservedFitnessMediaPath(redirectPath)) {
          return apiErrorResponse(404)
        }
        return Response.redirect(redirectUrl, 308)
      }
      default: {
        return apiErrorResponse(404)
      }
    }
  },
  {
    addAttributes: async (_req, context) => {
      const { pathname } = await context.params
      return {
        pathname: Array.isArray(pathname) ? pathname.join('/') : pathname
      }
    }
  }
)
