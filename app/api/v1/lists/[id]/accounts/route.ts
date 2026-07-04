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

// https://docs.joinmastodon.org/methods/lists/#accounts
export const GET = traceApiRoute(
  'getListAccounts',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:lists']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const list = await database.getList({ id, actorId: currentActor.id })
      if (!list) {
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

      const { accounts, nextMaxId, prevMinId } = await database.getListAccounts(
        {
          listId: id,
          actorId: currentActor.id,
          limit,
          maxId: url.searchParams.get('max_id'),
          // The prev link we emit uses min_id, so accept it as well as the
          // legacy since_id for newer-page pagination.
          sinceId:
            url.searchParams.get('since_id') || url.searchParams.get('min_id')
        }
      )

      const host = headerHost(req.headers)
      const buildLink = (cursorParam: 'max_id' | 'min_id', value: string) => {
        const params = new URLSearchParams()
        params.set('limit', `${limit}`)
        params.set(cursorParam, value)
        return `<https://${host}/api/v1/lists/${id}/accounts?${params.toString()}>; rel="${
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

// Collect account_ids from a repeated-param source, preferring the bracket
// form (account_ids[]=…) that native clients send, falling back to a bare
// account_ids key. `getAll` returns string[] (URLSearchParams) or
// FormDataEntryValue[] (FormData); non-string entries are dropped.
const collectAccountIds = (getAll: (name: string) => unknown[]): string[] => {
  const bracket = getAll('account_ids[]')
  const values = bracket.length > 0 ? bracket : getAll('account_ids')
  return values.filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
}

// Accepts account_ids as a JSON array, a form/multipart bracket array
// (account_ids[]=…), or — for DELETE, which masto.js serialises into the query
// string rather than the request body — repeated query params.
const parseAccountIds = async (req: Request): Promise<string[] | null> => {
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  let accountIds: string[] = []

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await req.text())
    accountIds = collectAccountIds((name) => params.getAll(name))
  } else if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    accountIds = collectAccountIds((name) => form.getAll(name))
  } else {
    const json = await req.json().catch(() => null)
    const parsed = AccountIdsBody.safeParse(json)
    if (parsed.success) accountIds = parsed.data.account_ids
  }

  if (accountIds.length === 0) {
    const query = new URL(req.url).searchParams
    accountIds = collectAccountIds((name) => query.getAll(name))
  }

  return accountIds.length > 0 ? accountIds : null
}

// https://docs.joinmastodon.org/methods/lists/#accounts-add
export const POST = traceApiRoute(
  'addListAccounts',
  OAuthGuard<Params>(
    [Scope.enum['write:lists']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const list = await database.getList({ id, actorId: currentActor.id })
      if (!list) {
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

      await database.addListAccounts({
        listId: id,
        actorId: currentActor.id,
        targetActorIds: accountIds.map((accountId) => idToUrl(accountId))
      })
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)

// https://docs.joinmastodon.org/methods/lists/#accounts-remove
export const DELETE = traceApiRoute(
  'removeListAccounts',
  OAuthGuard<Params>(
    [Scope.enum['write:lists']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const list = await database.getList({ id, actorId: currentActor.id })
      if (!list) {
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

      await database.removeListAccounts({
        listId: id,
        actorId: currentActor.id,
        targetActorIds: accountIds.map((accountId) => idToUrl(accountId))
      })
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
