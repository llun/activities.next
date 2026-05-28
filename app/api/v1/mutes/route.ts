import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getFallbackMutedAccount } from '@/lib/services/accounts/getFallbackMutedAccount'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getMutes',
  OAuthGuard([Scope.enum.read], async (req, { database, currentActor }) => {
    const url = new URL(req.url)
    const parsedLimit = parseInt(
      url.searchParams.get('limit') || `${PER_PAGE_LIMIT}`,
      10
    )
    const limit =
      Number.isSafeInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : PER_PAGE_LIMIT

    const mutes = await database.getMutes({
      actorId: currentActor.id,
      limit,
      maxId: url.searchParams.get('max_id'),
      minId: url.searchParams.get('min_id'),
      sinceId: url.searchParams.get('since_id')
    })

    const targetActorIds = mutes.map((mute) => mute.targetActorId)
    const hydratedAccounts =
      targetActorIds.length > 0
        ? await database.getMastodonActorsFromIds({ ids: targetActorIds })
        : []
    const accountsByUrl = new Map(
      hydratedAccounts.map((account) => [account.url, account])
    )
    const accounts = mutes.map(
      (mute) =>
        accountsByUrl.get(mute.targetActorId) ?? getFallbackMutedAccount(mute)
    )

    const host = headerHost(req.headers)
    const buildPaginationUrl = (cursorParam: string, cursorValue: string) => {
      const params = new URLSearchParams()
      params.set('limit', limit.toString())
      params.set(cursorParam, cursorValue)

      return `<https://${host}/api/v1/mutes?${params.toString()}>; rel="${cursorParam === 'max_id' ? 'next' : 'prev'}"`
    }
    const nextLink =
      mutes.length === limit
        ? buildPaginationUrl('max_id', mutes[mutes.length - 1].id)
        : null
    const prevLink =
      mutes.length > 0 ? buildPaginationUrl('min_id', mutes[0].id) : null
    const links = [nextLink, prevLink].filter(Boolean).join(', ')

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: accounts,
      additionalHeaders: [
        ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
      ]
    })
  })
)
