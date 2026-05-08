import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { Block } from '@/lib/types/domain/block'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { urlToId } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const MAX_LIMIT = 80

export const OPTIONS = defaultOptions(CORS_HEADERS)

const getFallbackAccount = (block: Block): MastodonAccount => {
  const username =
    block.targetActorId.split('/').filter(Boolean).pop() ||
    block.targetActorHost

  return {
    id: urlToId(block.targetActorId),
    username,
    acct: `${username}@${block.targetActorHost}`,
    url: block.targetActorId,
    display_name: 'Account unavailable',
    note: '',
    avatar: '',
    avatar_static: '',
    header: '',
    header_static: '',
    locked: false,
    source: {
      note: '',
      fields: [],
      privacy: 'public',
      sensitive: false,
      language: 'en',
      follow_requests_count: 0
    },
    fields: [],
    emojis: [],
    bot: false,
    group: false,
    discoverable: false,
    noindex: true,
    created_at: getISOTimeUTC(block.createdAt),
    last_status_at: null,
    statuses_count: 0,
    followers_count: 0,
    following_count: 0
  }
}

export const GET = traceApiRoute(
  'getBlocks',
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
    const blocks = await database.getBlocks({
      actorId: currentActor.id,
      limit,
      maxId: url.searchParams.get('max_id'),
      minId: url.searchParams.get('min_id') || url.searchParams.get('since_id')
    })

    const accounts = await Promise.all(
      blocks.map(async (block) => {
        const account = await database.getMastodonActorFromId({
          id: block.targetActorId
        })
        return account ?? getFallbackAccount(block)
      })
    )
    const host = headerHost(req.headers)
    const buildPaginationUrl = (cursorParam: string, cursorValue: string) => {
      const params = new URLSearchParams()
      params.set('limit', limit.toString())
      params.set(cursorParam, cursorValue)

      return `<https://${host}/api/v1/blocks?${params.toString()}>; rel="${cursorParam === 'max_id' ? 'next' : 'prev'}"`
    }
    const nextLink =
      blocks.length === limit
        ? buildPaginationUrl('max_id', blocks[blocks.length - 1].id)
        : null
    const prevLink =
      blocks.length > 0 ? buildPaginationUrl('min_id', blocks[0].id) : null
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
