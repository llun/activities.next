import { NextRequest } from 'next/server'

import { getPdsConfig } from '@/lib/config/blueskyPds'
import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import {
  getPdsDomainForRequest,
  withXrpcHsts,
  xrpcJsonResponse,
  xrpcNotFoundResponse,
  xrpcOptionsResponse
} from '@/lib/services/pds'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

const DID_DOC_ALLOW_METHODS = 'GET, HEAD, OPTIONS'

const handleDidDocument = async (
  req: NextRequest,
  forceHead = false
): Promise<Response> => {
  const isHead = forceHead || req.method === 'HEAD'
  const pdsDomain = getPdsDomainForRequest(req.headers)
  if (!pdsDomain) {
    return withXrpcHsts(xrpcNotFoundResponse(isHead), req)
  }

  return withXrpcHsts(
    xrpcJsonResponse(
      {
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: pdsDomain.did,
        service: [
          {
            id: '#atproto_pds',
            type: 'AtprotoPersonalDataServer',
            serviceEndpoint: `https://${pdsDomain.hostname}`
          }
        ]
      },
      { isHead }
    ),
    req
  )
}

export const OPTIONS = async (req: NextRequest): Promise<Response> => {
  if (!getPdsConfig()) {
    return withXrpcHsts(xrpcNotFoundResponse(), req)
  }
  await ensureServedDomainsFresh()
  const pdsDomain = getPdsDomainForRequest(req.headers)
  if (!pdsDomain) {
    return withXrpcHsts(xrpcNotFoundResponse(), req)
  }
  return withXrpcHsts(xrpcOptionsResponse(DID_DOC_ALLOW_METHODS), req)
}

export const GET = traceApiRoute('wellKnownDidJson', (req: NextRequest) =>
  handleDidDocument(req, false)
)

export const HEAD = traceApiRoute('wellKnownDidJsonHead', (req: NextRequest) =>
  handleDidDocument(req, true)
)
