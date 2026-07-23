import { NextRequest } from 'next/server'

import { buildBaseURL, getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { headerHost } from '@/lib/services/guards/headerHost'
import { MAX_PINNED_STATUSES } from '@/lib/services/mastodon/constants'
import {
  getInstanceContactAccount,
  getInstanceContactEmail,
  getInstanceStats
} from '@/lib/services/mastodon/instance'
import { ACCEPTED_FILE_TYPES } from '@/lib/services/medias/constants'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { InstanceRuleData } from '@/lib/types/database/operations'
import { Rule } from '@/lib/types/mastodon/rule'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { VERSION } from '@/lib/utils/version'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// Public per Mastodon: GET /api/v1/instance is served unauthenticated. The
// payload must stay robust — database failures degrade to zeroed stats, an
// empty rules list and a null contact account instead of a 500.
export const GET = traceApiRoute('getInstance', async (req: NextRequest) => {
  const config = getConfig()
  const database = getDatabase()
  const domain = headerHost(req.headers)
  const baseUrl = buildBaseURL(domain)

  let rules: InstanceRuleData[] = []
  if (database) {
    try {
      rules = await database.getInstanceRules()
    } catch (error) {
      logger.warn({
        message: 'Failed to load instance rules for /api/v1/instance',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const [stats, contactAccount, serverSettings] = await Promise.all([
    getInstanceStats(database, config.host),
    getInstanceContactAccount(database),
    getResolvedServerSettings(database)
  ])

  const data = {
    uri: domain,
    title: serverSettings.instance.name,
    short_description: serverSettings.instance.description,
    description: serverSettings.instance.description,
    email:
      serverSettings.instance.contactEmail || getInstanceContactEmail(config),
    version: VERSION,
    // No streaming API: the documented key is present but empty so clients
    // treat streaming as unavailable and fall back to polling.
    urls: { streaming_api: '' },
    // Integers per the V1::Instance entity — only /api/v1/instance/activity
    // stringifies its numbers.
    stats: {
      user_count: stats.userCount,
      status_count: stats.statusCount,
      domain_count: stats.domainCount
    },
    thumbnail: `${baseUrl}/logo.png`,
    languages: serverSettings.instance.languages,
    registrations: serverSettings.registrations.open,
    approval_required: false,
    invites_enabled: false,
    configuration: {
      statuses: {
        max_characters: serverSettings.posts.maxCharacters,
        max_media_attachments: serverSettings.posts.maxMediaAttachments,
        characters_reserved_per_url: 23
      },
      accounts: {
        max_pinned_statuses: MAX_PINNED_STATUSES
      },
      media_attachments: {
        supported_mime_types: ACCEPTED_FILE_TYPES,
        image_size_limit: serverSettings.media.maxFileSize,
        image_matrix_limit: 16777216,
        video_size_limit: serverSettings.media.maxFileSize,
        video_frame_rate_limit: 60,
        video_matrix_limit: 2304000
      },
      polls: {
        max_options: serverSettings.polls.maxOptions,
        max_characters_per_option: serverSettings.polls.maxCharactersPerOption,
        min_expiration: serverSettings.polls.minExpirationSeconds,
        max_expiration: serverSettings.polls.maxExpirationSeconds
      }
    },
    contact_account: contactAccount,
    rules: rules.map((rule): Rule => ({
      id: rule.id,
      text: rule.text,
      hint: rule.hint
    }))
  }
  return apiResponse({ req, allowedMethods: CORS_HEADERS, data })
})
