import { z } from 'zod'

import {
  OAuthGuardAnyScope,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
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

const MarkerInput = z.object({ last_read_id: z.string().min(1) })
const PostBody = z.object({
  home: MarkerInput.optional(),
  notifications: MarkerInput.optional()
})

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

export const GET = traceApiRoute(
  'getMarkers',
  OAuthGuardAnyScope<{}>(
    [Scope.enum.read, Scope.enum['read:statuses']],
    async (req, context) => {
      const { currentActor, database } = context
      const requested = new URL(req.url).searchParams.getAll('timeline[]')
      const timelines = requested.filter((value): value is MarkerTimeline =>
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
    },
    guardOptions
  )
)

const parseBody = async (req: Request): Promise<unknown> => {
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase()
  if (contentType.includes('application/json')) {
    return req.json()
  }
  // Mastodon clients send form fields like `home[last_read_id]`.
  const params = new URLSearchParams(await req.text())
  const body: Record<string, { last_read_id?: string }> = {}
  for (const [key, value] of params.entries()) {
    const match = key.match(/^(home|notifications)\[last_read_id\]$/)
    if (match) {
      body[match[1]] = { last_read_id: value }
    }
  }
  return body
}

export const POST = traceApiRoute(
  'updateMarkers',
  OAuthGuardAnyScope<{}>(
    [Scope.enum.write, Scope.enum['write:statuses']],
    async (req, context) => {
      const { currentActor, database } = context

      let json: unknown
      try {
        json = await parseBody(req)
      } catch {
        json = {}
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
    },
    guardOptions
  )
)
