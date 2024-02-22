import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { VERSION } from '@/lib/constants'
import { defaultOptions, defaultStatusOption } from '@/lib/response'
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_SIZE
} from '@/lib/services/medias/constants'
import { HttpMethod, getCORSHeaders } from '@/lib/utils/getCORSHeaders'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = async (req: NextRequest) => {
  const config = getConfig()
  const data = {
    uri: config.host,
    title: config.serviceName ?? 'Activities.next',
    short_description:
      config.serviceDescription ?? 'Personal activity pub server with Next.js',
    description:
      config.serviceDescription ?? 'Personal activity pub server with Next.js',
    email: '-',
    version: VERSION,
    thumbnail: '',
    languages: config.languages,
    registrations: false,
    approval_required: false,
    invites_enabled: false,
    configuration: {
      statuses: {
        max_characters: 500,
        max_media_attachments: 4,
        characters_reserved_per_url: 23
      },
      media_attachments: {
        supported_mime_types: ACCEPTED_FILE_TYPES,
        image_size_limit: MAX_FILE_SIZE,
        image_matrix_limit: 16777216,
        video_size_limit: MAX_FILE_SIZE,
        video_frame_rate_limit: 60,
        video_matrix_limit: 2304000
      },
      polls: {
        max_options: 4,
        max_characters_per_option: 50,
        min_expiration: 300,
        max_expiration: 2629746
      }
    }
  }
  return Response.json(data, {
    ...defaultStatusOption(200),
    headers: new Headers(getCORSHeaders(CORS_HEADERS, req.headers))
  })
}
