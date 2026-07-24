import { NextRequest } from 'next/server'

import { buildBaseURL, getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { headerHost } from '@/lib/services/guards/headerHost'
import {
  MASTODON_INSTANCE_API_VERSION,
  MAX_PINNED_STATUSES
} from '@/lib/services/mastodon/constants'
import {
  getInstanceContactAccount,
  getInstanceContactEmail,
  getInstanceStats
} from '@/lib/services/mastodon/instance'
import { ACCEPTED_FILE_TYPES } from '@/lib/services/medias/constants'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { isTranslationEnabled } from '@/lib/services/translation'
import { InstanceRuleData } from '@/lib/types/database/operations'
import { Rule } from '@/lib/types/mastodon/rule'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { VERSION } from '@/lib/utils/version'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Public per Mastodon: GET /api/v2/instance is served unauthenticated.
export const GET = traceApiRoute('getInstanceV2', async (req: NextRequest) => {
  const config = getConfig()
  const domain = headerHost(req.headers)
  const baseUrl = buildBaseURL(domain)
  // The instance payload must stay robust: when the database is unavailable,
  // serve the static configuration with an empty rules list, zeroed usage and
  // a null contact account instead of failing.
  const database = getDatabase()
  let rules: InstanceRuleData[] = []
  if (database) {
    try {
      rules = await database.getInstanceRules()
    } catch (error) {
      // A query failure (timeout, lock, etc.) must not take down the public
      // metadata endpoint — fall back to an empty rules list.
      logger.warn({
        message: 'Failed to load instance rules for /api/v2/instance',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  const [stats, contactAccount, serverSettings] = await Promise.all([
    getInstanceStats(database, config.host),
    getInstanceContactAccount(database),
    getResolvedServerSettings(database)
  ])
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      domain,
      title: serverSettings.instance.name,
      version: VERSION,
      source_url: 'https://github.com/llun/activities.next',
      description: serverSettings.instance.description,
      usage: {
        users: {
          active_month: stats.activeMonth
        }
      },
      thumbnail: {
        url: `${baseUrl}/logo.png`,
        versions: {
          '@1x': `${baseUrl}/logo.png`,
          '@2x': `${baseUrl}/logo.png`
        }
      },
      icon: [
        { src: `${baseUrl}/icon-192.png`, size: '192x192' },
        { src: `${baseUrl}/icon-512.png`, size: '512x512' }
      ],
      languages: serverSettings.instance.languages,
      api_versions: {
        mastodon: MASTODON_INSTANCE_API_VERSION
      },
      configuration: {
        // No streaming API yet: keep the documented key present but empty so
        // JS clients treat it as falsy and fall back to REST polling instead
        // of opening a WebSocket that would fail.
        urls: {
          streaming: ''
        },
        vapid: {
          public_key: config.push?.vapidPublicKey ?? ''
        },
        accounts: {
          max_featured_tags: 10,
          max_pinned_statuses: MAX_PINNED_STATUSES
        },
        statuses: {
          max_characters: serverSettings.posts.maxCharacters,
          max_media_attachments: serverSettings.posts.maxMediaAttachments,
          characters_reserved_per_url: 23
        },
        media_attachments: {
          supported_mime_types: ACCEPTED_FILE_TYPES,
          image_size_limit: serverSettings.media.maxFileSize,
          image_matrix_limit: 33177600,
          video_size_limit: serverSettings.media.maxFileSize,
          video_frame_rate_limit: 120,
          video_matrix_limit: 8294400
        },
        polls: {
          max_options: serverSettings.polls.maxOptions,
          max_characters_per_option:
            serverSettings.polls.maxCharactersPerOption,
          min_expiration: serverSettings.polls.minExpirationSeconds,
          max_expiration: serverSettings.polls.maxExpirationSeconds
        },
        translation: {
          enabled: isTranslationEnabled()
        }
      },
      registrations: {
        enabled: serverSettings.registrations.open,
        approval_required: false,
        message: null,
        url: null
      },
      contact: {
        email:
          serverSettings.instance.contactEmail ||
          getInstanceContactEmail(config),
        account: contactAccount
      },
      rules: rules.map((rule): Rule => ({
        id: rule.id,
        text: rule.text,
        hint: rule.hint
      }))
    }
  })
})
