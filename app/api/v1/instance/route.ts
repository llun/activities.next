import { NextRequest } from 'next/server'

import { buildBaseURL, getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { headerHost } from '@/lib/services/guards/headerHost'
import {
  MAX_PINNED_STATUSES,
  MAX_STORED_MEDIA_ATTACHMENTS
} from '@/lib/services/mastodon/constants'
import {
  getInstanceContactAccount,
  getInstanceContactEmail,
  getInstanceStats
} from '@/lib/services/mastodon/instance'
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_SIZE
} from '@/lib/services/medias/constants'
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

  const [stats, contactAccount] = await Promise.all([
    getInstanceStats(database, config.host),
    getInstanceContactAccount(database)
  ])

  const data = {
    uri: domain,
    title: config.serviceName ?? 'Activities.next',
    short_description:
      config.serviceDescription ?? 'Personal activity pub server with Next.js',
    description:
      config.serviceDescription ?? 'Personal activity pub server with Next.js',
    email: getInstanceContactEmail(config),
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
    languages: config.languages,
    registrations: config.registrationOpen,
    approval_required: false,
    invites_enabled: false,
    configuration: {
      statuses: {
        max_characters: 500,
        max_media_attachments: MAX_STORED_MEDIA_ATTACHMENTS,
        characters_reserved_per_url: 23
      },
      accounts: {
        max_pinned_statuses: MAX_PINNED_STATUSES
      },
      media_attachments: {
        supported_mime_types: ACCEPTED_FILE_TYPES,
        image_size_limit: config.mediaStorage?.maxFileSize ?? MAX_FILE_SIZE,
        image_matrix_limit: 16777216,
        video_size_limit: config.mediaStorage?.maxFileSize ?? MAX_FILE_SIZE,
        video_frame_rate_limit: 60,
        video_matrix_limit: 2304000
      },
      polls: {
        max_options: 4,
        max_characters_per_option: 50,
        min_expiration: 300,
        max_expiration: 2629746
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
