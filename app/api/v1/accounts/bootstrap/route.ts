import type { ClientBootstrapSnapshot } from '@/lib/client/offline/types'
import { getConfig } from '@/lib/config'
import { getRequestFeatures } from '@/lib/services/domains/visitedFeatures'
import {
  OAuthGuardAnyScope,
  isBearerAuthorizationHeader
} from '@/lib/services/guards/OAuthGuard'
import {
  sanitizeNavHidden,
  sanitizeNavOrder
} from '@/lib/services/navigation/navPreferences'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { Scope } from '@/lib/types/database/operations'
import { getActorProfile, getMention } from '@/lib/types/domain/actor'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/http-headers'
import { isRealAvatar } from '@/lib/utils/isRealAvatar'
import { logger } from '@/lib/utils/logger'
import { apiCorsError, apiResponse, defaultOptions } from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getAccountBootstrap',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async (req, { currentActor, database }) => {
      try {
        if (!currentActor.account) {
          return apiCorsError(req, CORS_HEADERS, 401)
        }

        const { host, mediaStorage } = getConfig()
        // The report count is moderation data a third-party app holding only
        // `read` should not see (Mastodon gates it behind admin:read:reports).
        // The guard authenticates a bearer token when the Authorization header
        // carries one and the session cookie otherwise, so the header tells the
        // two apart: only the first-party (cookie) client gets the count.
        const isFirstParty = !isBearerAuthorizationHeader(
          req.headers.get('Authorization')
        )
        const [
          serverSettings,
          actors,
          unreadCount,
          openReportCount,
          lists,
          actorSettings
        ] = await Promise.all([
          getResolvedServerSettings(database),
          database.getActorsForAccount({
            accountId: currentActor.account.id
          }),
          database.getNotificationsCount({
            actorId: currentActor.id,
            onlyUnread: true
          }),
          // The Admin item's unresolved report count, for first-party admins.
          !isFirstParty
            ? Promise.resolve(undefined)
            : currentActor.account.role === 'admin'
              ? database.countOpenReports({ limit: 100 })
              : Promise.resolve(0),
          database.getLists({ actorId: currentActor.id }),
          database.getActorSettings({ actorId: currentActor.id })
        ])

        const { posts, media, polls } = serverSettings
        // The server's switches, minus what the visited domain turned off.
        const features = await getRequestFeatures(
          database,
          req.headers,
          serverSettings.features
        )

        const instanceLimits = {
          maxStatusCharacters: posts.maxCharacters,
          maxMediaFileSize: media.maxFileSize,
          maxMediaAttachments: posts.maxMediaAttachments,
          maxPollOptions: polls.maxOptions,
          maxPollOptionCharacters: polls.maxCharactersPerOption,
          minPollExpirationSeconds: polls.minExpirationSeconds,
          maxPollExpirationSeconds: polls.maxExpirationSeconds
        }

        const formattedActors = actors.map((a) => ({
          id: a.id,
          username: a.username,
          domain: a.domain,
          name: a.name,
          iconUrl: isRealAvatar(a.iconUrl) ? a.iconUrl : null,
          deletionStatus: a.deletionStatus ?? null,
          deletionScheduledAt: a.deletionScheduledAt ?? null
        }))

        const formattedLists = lists.map((list) => ({
          id: list.id,
          title: list.title
        }))

        const settingsWithOptional = actorSettings as
          | (NonNullable<typeof actorSettings> & {
              readingGroupBoosts?: boolean
            })
          | null

        const user = {
          name: currentActor.name || currentActor.username,
          username: currentActor.username,
          handle: getMention(currentActor, true),
          avatarUrl: isRealAvatar(currentActor.iconUrl)
            ? currentActor.iconUrl
            : null
        }

        const formattedCurrentActor = {
          id: currentActor.id,
          username: currentActor.username,
          domain: currentActor.domain,
          name: currentActor.name,
          iconUrl: isRealAvatar(currentActor.iconUrl)
            ? currentActor.iconUrl
            : null
        }

        const now = Date.now()
        const snapshot: ClientBootstrapSnapshot = {
          accountId: currentActor.account.id,
          actorId: currentActor.id,
          host,
          currentTime: now,
          user,
          currentActor: formattedCurrentActor,
          actors: formattedActors,
          profile: getActorProfile(currentActor),
          unreadCount,
          openReportCount,
          fitnessUrl:
            currentActor.account && features.fitness ? '/fitness' : undefined,
          galleryUrl: currentActor.account ? '/gallery' : undefined,
          isAdmin: currentActor.account?.role === 'admin',
          isMediaUploadEnabled: Boolean(mediaStorage),
          lists: formattedLists,
          features,
          instanceLimits,
          // Sanitized, so an order saved before Profile replaced Account is
          // served (and cached offline) with 'profile' in its slot.
          navOrder: actorSettings?.navOrder
            ? sanitizeNavOrder(actorSettings.navOrder)
            : undefined,
          navHidden: actorSettings?.navHidden
            ? sanitizeNavHidden(actorSettings.navHidden)
            : undefined,
          readingAutoplayGifs: actorSettings?.readingAutoplayGifs ?? false,
          postLineLimit: actorSettings?.postLineLimit,
          readingGroupBoosts: settingsWithOptional?.readingGroupBoosts ?? true,
          savedAt: now
        }

        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: cleanJson(snapshot)
        })
      } catch (e) {
        logger.error({
          message: 'Failed to generate account bootstrap snapshot',
          err: toLoggableError(e)
        })
        return apiCorsError(req, CORS_HEADERS, 500)
      }
    }
  )
)
