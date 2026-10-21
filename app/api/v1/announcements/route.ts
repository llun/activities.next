import { getAnnouncementsDomainForHost } from '@/lib/services/domains/domainAudience'
import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import { OAuthGuard, corsErrorResponse } from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { getMastodonAnnouncement } from '@/lib/services/mastodon/getMastodonAnnouncement'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const guardOptions = { errorResponse: corsErrorResponse(CORS_HEADERS) }

export const GET = traceApiRoute(
  'getAnnouncements',
  OAuthGuard<{}>(
    [Scope.enum.read],
    async (req, { database, currentActor }) => {
      // The announcements for every domain, plus those for the visited one
      // (an extension: Mastodon has one list per server). Refresh first:
      // `headerHost` trusts the visited host from the snapshot.
      await ensureServedDomainsFresh()
      const announcements = await database.getActiveAnnouncements({
        now: Date.now(),
        domain: await getAnnouncementsDomainForHost(
          database,
          headerHost(req.headers)
        )
      })
      const ids = announcements.map((announcement) => announcement.id)

      const [readIds, reactions, customEmojis] = await Promise.all([
        database.getAnnouncementReadIds({
          actorId: currentActor.id,
          announcementIds: ids
        }),
        database.getAnnouncementReactions({
          announcementIds: ids,
          actorId: currentActor.id
        }),
        database.getCustomEmojis()
      ])

      const readIdSet = new Set(readIds)
      const data = announcements.map((announcement) =>
        getMastodonAnnouncement({
          announcement,
          read: readIdSet.has(announcement.id),
          reactions: reactions.filter(
            (reaction) => reaction.announcementId === announcement.id
          ),
          customEmojis
        })
      )

      return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
    },
    guardOptions
  )
)
