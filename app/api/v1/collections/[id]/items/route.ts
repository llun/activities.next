import { z } from 'zod'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

// List the accounts in a collection. The owner sees all members; everyone else
// is served the public projection (approved members only).
export const GET = traceApiRoute(
  'getCollectionItems',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const collection = await database.getCollection({
        id,
        actorId: currentActor.id
      })
      if (!collection) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const url = new URL(req.url)
      const parsedLimit = parseInt(
        url.searchParams.get('limit') ?? `${PER_PAGE_LIMIT}`,
        10
      )
      const limit =
        Number.isSafeInteger(parsedLimit) && parsedLimit > 0
          ? Math.min(parsedLimit, MAX_LIMIT)
          : PER_PAGE_LIMIT

      const { accounts, nextMaxId, prevMinId } =
        await database.getCollectionMembers({
          id,
          actorId: currentActor.id,
          projection: 'owner',
          limit,
          maxId: url.searchParams.get('max_id'),
          sinceId:
            url.searchParams.get('since_id') || url.searchParams.get('min_id')
        })

      const host = headerHost(req.headers)
      const buildLink = (cursorParam: 'max_id' | 'min_id', value: string) => {
        const linkParams = new URLSearchParams()
        linkParams.set('limit', `${limit}`)
        linkParams.set(cursorParam, value)
        return `<https://${host}/api/v1/collections/${id}/items?${linkParams.toString()}>; rel="${
          cursorParam === 'max_id' ? 'next' : 'prev'
        }"`
      }
      const links = [
        accounts.length === limit && nextMaxId
          ? buildLink('max_id', nextMaxId)
          : null,
        prevMinId ? buildLink('min_id', prevMinId) : null
      ]
        .filter(Boolean)
        .join(', ')

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: accounts,
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    }
  )
)

const AccountIdsBody = z.object({
  account_ids: z.array(z.string().min(1)).min(1)
})

const parseAccountIds = async (req: Request): Promise<string[] | null> => {
  const json = await req.json().catch(() => null)
  const parsed = AccountIdsBody.safeParse(json)
  if (!parsed.success) return null
  return parsed.data.account_ids
}

export const POST = traceApiRoute(
  'addCollectionItems',
  OAuthGuard<Params>(
    [Scope.enum['write:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const collection = await database.getCollection({
        id,
        actorId: currentActor.id
      })
      if (!collection) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const accountIds = await parseAccountIds(req)
      if (!accountIds) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      await database.addCollectionMembers({
        id,
        actorId: currentActor.id,
        targetActorIds: accountIds.map((accountId) => idToUrl(accountId))
      })
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)

export const DELETE = traceApiRoute(
  'removeCollectionItems',
  OAuthGuard<Params>(
    [Scope.enum['write:collections']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const collection = await database.getCollection({
        id,
        actorId: currentActor.id
      })
      if (!collection) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      const accountIds = await parseAccountIds(req)
      if (!accountIds) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      await database.removeCollectionMembers({
        id,
        actorId: currentActor.id,
        targetActorIds: accountIds.map((accountId) => idToUrl(accountId))
      })
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
