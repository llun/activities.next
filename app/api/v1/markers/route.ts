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
      const url = new URL(req.url)
      const requested = [
        ...url.searchParams.getAll('timeline[]'),
        ...url.searchParams.getAll('timeline')
      ]
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
    const text = await req.text()
    if (text.trim() === '') return {}
    return JSON.parse(text)
  }
  // Mastodon clients send form fields like `home[last_read_id]`.
  // multipart/form-data is parsed via req.formData() at runtime; the
  // urlencoded branch uses URLSearchParams. Both are iterable as [string, …].
  // NOTE: req.formData() is runtime-only — not exercised by unit tests (jest
  // synthetic bodies throw); only the urlencoded/json branches are unit-tested.
  const entries: Iterable<[string, FormDataEntryValue | string]> =
    contentType.includes('multipart/form-data')
      ? await req.formData()
      : new URLSearchParams(await req.text())
  const body: Record<string, { last_read_id?: string }> = {}
  for (const [key, value] of entries) {
    if (typeof value !== 'string') continue
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
    },
    guardOptions
  )
)
