import type { ClientBootstrapSnapshot } from '@/lib/client/offline/types'
import { getConfig } from '@/lib/config'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
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
        const [serverSettings, actors, unreadCount, lists, actorSettings] =
          await Promise.all([
            getResolvedServerSettings(database),
            database.getActorsForAccount({
              accountId: currentActor.account.id
            }),
            database.getNotificationsCount({
              actorId: currentActor.id,
              onlyUnread: true
            }),
            database.getLists({ actorId: currentActor.id }),
            database.getActorSettings({ actorId: currentActor.id })
          ])

        const { posts, media, polls, features } = serverSettings

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
          fitnessUrl:
            currentActor.account && features.fitness ? '/fitness' : undefined,
          galleryUrl: currentActor.account ? '/gallery' : undefined,
          isAdmin: currentActor.account?.role === 'admin',
          isMediaUploadEnabled: Boolean(mediaStorage),
          lists: formattedLists,
          features,
          instanceLimits,
          navOrder:
            actorSettings?.navOrder as ClientBootstrapSnapshot['navOrder'],
          navHidden:
            actorSettings?.navHidden as ClientBootstrapSnapshot['navHidden'],
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
