import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { UsableScopes } from '@/lib/database/types/oauth'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'

export const dynamic = 'force-dynamic'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = async (req: NextRequest) => {
  const config = getConfig()
  return apiResponse(req, CORS_HEADERS, {
    issuer: `https://${config.host}/`,
    authorization_endpoint: `https://${config.host}/oauth/authorize`,
    token_endpoint: `https://${config.host}/oauth/token`,
    revocation_endpoint: `https://${config.host}/oauth/revoke`,
    scopes_supported: UsableScopes,
    response_types_supported: ['code'],
    response_modes_supported: ['query', 'fragment', 'form_post'],
    grant_types_supported: [
      'authorization_code',
      'password',
      'client_credentials'
    ],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post'
    ],
    code_challenge_methods_supported: ['S256'],
    service_documentation: 'https://github.com/llun/activities.next',
    app_registration_endpoint: `https://${config.host}/api/v1/apps`
  })
}
