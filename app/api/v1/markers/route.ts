import { z } from 'zod'

import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonMarkers } from '@/lib/services/mastodon/getMastodonMarkers'
import { MarkerTimeline, Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

const TIMELINES: MarkerTimeline[] = ['home', 'notifications']

const MarkerInput = z.object({ last_read_id: z.coerce.string().min(1) })
const PostBody = z.object({
  home: MarkerInput.optional(),
  notifications: MarkerInput.optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getMarkers',
  OAuthGuard<{}>([Scope.enum.read], async (req, context) => {
    const { currentActor, database } = context
    const requested = new URL(req.url).searchParams.getAll('timeline[]')
    const timelines = (requested.length > 0 ? requested : TIMELINES).filter(
      (value): value is MarkerTimeline =>
        TIMELINES.includes(value as MarkerTimeline)
    )
    const rows = await database.getMarkers({
      actorId: currentActor.id,
      timelines
    })
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: getMastodonMarkers(rows)
    })
  })
)

const parseBody = async (req: Request): Promise<unknown> => {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return req.json()
  }
  // Mastodon clients send form fields like `home[last_read_id]`.
  const form = await req.formData()
  const body: Record<string, { last_read_id?: string }> = {}
  for (const [key, value] of form.entries()) {
    const match = key.match(/^(home|notifications)\[last_read_id\]$/)
    if (match) {
      body[match[1]] = { last_read_id: String(value) }
    }
  }
  return body
}

export const POST = traceApiRoute(
  'updateMarkers',
  OAuthGuard<{}>([Scope.enum.write], async (req, context) => {
    const { currentActor, database } = context

    let json: unknown
    try {
      json = await parseBody(req)
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Invalid request body' },
        responseStatusCode: 400
      })
    }

    const parsed = PostBody.safeParse(json)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Invalid marker' },
        responseStatusCode: 422
      })
    }

    const written = []
    for (const timeline of TIMELINES) {
      const input = parsed.data[timeline]
      if (!input) continue
      written.push(
        await database.upsertMarker({
          actorId: currentActor.id,
          timeline,
          lastReadId: input.last_read_id
        })
      )
    }

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: getMastodonMarkers(written)
    })
  })
)
