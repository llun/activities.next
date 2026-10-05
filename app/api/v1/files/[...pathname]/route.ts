import { readFile } from 'fs/promises'
import { NextRequest } from 'next/server'
import path from 'path'

import { getDatabase } from '@/lib/database'
import { getMedia } from '@/lib/services/medias'
import { isReservedFitnessMediaPath } from '@/lib/services/medias/reservedPaths'
import { getServedMediaHeaders } from '@/lib/services/medias/servedMediaHeaders'
import { getMediaFileContentSecurityPolicyHeader } from '@/lib/utils/http-headers/csp'
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

    // A client's own path reaches a storage driver here: the segments below go
    // to `getMedia`, which hands them to `LocalFileStorage.getFile`. Other
    // callers pass the driver a path they did not take from a request — see
    // "A stored path is confined to the storage root" in AGENTS.md, which
    // keeps that inventory — so this refusal is the check for THIS input. The
    // driver's own `resolveStorageFilePath` does not make it redundant: an
    // absolute path resolves outside the storage root, which that helper
    // answers with a null, and the route below turns a null into the
    // placeholder image — a miss served for a read it should never have made.
    // POSIX hosts do not treat Windows drive paths as absolute, hence the
    // second test.
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
        // Our own static file, so SVG is served inline here — but with the
        // same nosniff and sandboxed CSP as stored bytes.
        const csp = getMediaFileContentSecurityPolicyHeader()
        const headers = new Headers([
          ['Content-Type', 'image/svg+xml'],
          ['Cache-Control', 'public, max-age=3600'],
          ['X-Content-Type-Options', 'nosniff'],
          [csp.key, csp.value]
        ])
        return new Response(placeholderSvg, { headers })
      } catch (_error) {
        // Fallback if file can't be read
        return apiErrorResponse(404)
      }
    }

    switch (media.type) {
      case 'stream': {
        const { contentType, stream, contentLength } = media
        // The stored type is not trusted: on object storage it is whatever the
        // uploader's PUT declared. Anything outside the media allowlist is
        // served as a download, and nothing is served without nosniff and the
        // sandboxed CSP — this is the app's own origin.
        const headers = getServedMediaHeaders(contentType)
        // Make media cache for 1 year
        headers.set('Cache-Control', 'public, max-age=31536000, immutable')
        if (contentLength !== null) {
          headers.set('Content-Length', `${contentLength}`)
        }
        // Next answers HEAD by calling this GET handler and then ends the
        // response WITHOUT reading or cancelling its body. The stream holds an
        // open file handle (local driver) or a pooled socket (S3), so an
        // unconsumed one leaks until GC — or, for S3, pins the socket and
        // starves the agent. Release it here and send headers only.
        if (req.method === 'HEAD') {
          await stream.cancel().catch(() => undefined)
          return new Response(null, { headers })
        }
        return new Response(stream, { headers })
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
