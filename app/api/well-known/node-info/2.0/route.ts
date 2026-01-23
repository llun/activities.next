import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { NODE_SOFTWARE } from '@/lib/constants'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('nodeInfoV2', async (req: NextRequest) => {
  const config = getConfig()
  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: {
      metadata: {
        accountActivationRequired: true,
        features: [],
        federation: {
          enabled: true,
          exclusions: false,
          mrf_hashtag: {
            federated_timeline_removal: [],
            reject: [],
            sensitive: ['nsfw']
          },
          mrf_object_age: {
            actions: ['delist', 'strip_followers'],
            threshold: 604800
          },
          mrf_policies: [
            'ObjectAgePolicy',
            'TagPolicy',
            'HashtagPolicy',
            'InlineQuotePolicy',
            'NormalizeMarkup'
          ],
          quarantined_instances: [],
          quarantined_instances_info: { quarantined_instances: {} }
        },
        fieldsLimits: {
          maxFields: 10,
          maxRemoteFields: 20,
          nameLength: 512,
          valueLength: 2048
        },
        invitesEnabled: false,
        localBubbleInstances: [],
        mailerEnabled: false,
        nodeDescription:
          config.serviceDescription ??
          'Personal activity pub server with Next.js',
        nodeName: config.host,
        pollLimits: {
          max_expiration: 31536000,
          max_option_chars: 200,
          max_options: 20,
          min_expiration: 0
        },
        postFormats: ['text/plain', 'text/html'],
        private: false,
        restrictedNicknames: [
          '.well-known',
          '~',
          'about',
          'activities',
          'api',
          'auth',
          'check_password',
          'dev',
          'friend-requests',
          'inbox',
          'internal',
          'main',
          'media',
          'nodeinfo',
          'notice',
          'oauth',
          'objects',
          'ostatus_subscribe',
          'pleroma',
          'proxy',
          'push',
          'registration',
          'relay',
          'settings',
          'status',
          'tag',
          'user-search',
          'user_exists',
          'users',
          'web',
          'verify_credentials',
          'update_credentials',
          'relationships',
          'search',
          'confirmation_resend',
          'mfa',
          'null'
        ],
        skipThreadContainment: true,
        staffAccounts: [],
        suggestions: { enabled: false },
        uploadLimits: {
          avatar: 2000000,
          background: 4000000,
          banner: 4000000,
          general: 16000000
        }
      },
      openRegistrations: false,
      protocols: ['activitypub'],
      services: { inbound: [], outbound: [] },
      software: NODE_SOFTWARE,
      usage: { localPosts: 150, users: { total: 1 } },
      version: '2.0'
    }
  })
})
