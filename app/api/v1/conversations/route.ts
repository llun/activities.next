import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonConversation } from '@/lib/services/mastodon/getMastodonConversation'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { Mastodon } from '@/lib/types/activitypub'
import { Scope } from '@/lib/types/database/operations'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 40

export const OPTIONS = defaultOptions(CORS_HEADERS)

const normalizeLimit = (value: string | null) => {
  const parsed = parseInt(value || `${DEFAULT_LIMIT}`, 10)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, MAX_LIMIT)
    : DEFAULT_LIMIT
}

export const GET = traceApiRoute(
  'getConversations',
  OAuthGuardAnyScope(
    [
      Scope.enum.read,
      Scope.enum['read:conversations'],
      Scope.enum['read:statuses']
    ],
    async (req, { database, currentActor }) => {
      const url = new URL(req.url)
      const limit = normalizeLimit(url.searchParams.get('limit'))
      const conversations = await database.getDirectConversations({
        actorId: currentActor.id,
        limit,
        maxId: url.searchParams.get('max_id'),
        minId: url.searchParams.get('min_id')
      })

      if (
        url.searchParams.get('format') === TimelineFormat.enum.activities_next
      ) {
        const conversationViews = await Promise.all(
          conversations.map(async (conversation) => {
            const accounts = (
              await Promise.all(
                conversation.participantActorIds
                  .filter((actorId) => actorId !== currentActor.id)
                  .map((actorId) =>
                    database.getMastodonActorFromId({ id: actorId })
                  )
              )
            ).filter((account): account is Mastodon.Account => account !== null)
            return {
              ...cleanJson(conversation),
              accounts
            }
          })
        )
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: {
            conversations: conversationViews
          }
        })
      }

      const mastodonConversations = (
        await Promise.all(
          conversations.map((conversation) =>
            getMastodonConversation(database, conversation, currentActor.id)
          )
        )
      ).filter(
        (conversation): conversation is Mastodon.Conversation =>
          conversation !== null
      )

      const host = headerHost(req.headers)
      const buildPaginationUrl = (cursorParam: string, cursorValue: string) => {
        const params = new URLSearchParams()
        params.set('limit', limit.toString())
        params.set(cursorParam, cursorValue)

        return `<https://${host}/api/v1/conversations?${params.toString()}>; rel="${
          cursorParam === 'max_id' ? 'next' : 'prev'
        }"`
      }
      const nextConversationId =
        conversations.length === limit
          ? conversations[conversations.length - 1].id
          : null
      const prevConversationId =
        conversations.length > 0 ? conversations[0].id : null
      const nextLink = nextConversationId
        ? buildPaginationUrl('max_id', nextConversationId)
        : null
      const prevLink = prevConversationId
        ? buildPaginationUrl('min_id', prevConversationId)
        : null
      const links = [nextLink, prevLink].filter(Boolean).join(', ')

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonConversations,
        additionalHeaders: [
          ...(links.length > 0 ? [['Link', links] as [string, string]] : [])
        ]
      })
    }
  )
)
