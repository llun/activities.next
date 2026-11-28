import { isValidNsid } from '@atproto/syntax'
import { NextRequest } from 'next/server'

import { getPdsConfig } from '@/lib/config/blueskyPds'
import { ensureServedDomainsFresh } from '@/lib/services/domains/servedDomainSnapshot'
import {
  getPdsDomainForRequest,
  withXrpcHsts,
  xrpcInvalidPathResponse,
  xrpcMethodNotAllowedResponse,
  xrpcMethodNotImplementedResponse,
  xrpcNotFoundResponse,
  xrpcOptionsResponse
} from '@/lib/services/pds'
import {
  getPdsXrpcDispatchEntry,
  isPdsXrpcCategoryEnabled
} from '@/lib/services/pds/dispatch'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const dynamic = 'force-dynamic'

interface Params {
  nsid?: string[]
}

const getSingleNsid = (segments: string[] | undefined): string | null =>
  segments && segments.length === 1 && segments[0] ? segments[0] : null

const handleGetOrHeadInner = async (
  req: NextRequest,
  context: { params: Promise<Params> },
  isHead: boolean
): Promise<Response> => {
  const pdsDomain = getPdsDomainForRequest(req.headers)
  if (!pdsDomain) {
    return xrpcNotFoundResponse(isHead)
  }

  const { nsid: segments } = await context.params
  const nsid = getSingleNsid(segments)
  if (!nsid) {
    return xrpcInvalidPathResponse(isHead)
  }

  const entry = getPdsXrpcDispatchEntry('GET', nsid)
  if (!entry || !isPdsXrpcCategoryEnabled(entry, pdsDomain) || !entry.handler) {
    return xrpcMethodNotImplementedResponse(isHead)
  }
  return entry.handler({ req, pdsDomain, nsid, isHead })
}

const handleGetOrHead = async (
  req: NextRequest,
  context: { params: Promise<Params> },
  forceHead = false
): Promise<Response> => {
  const isHead = forceHead || req.method === 'HEAD'
  return withXrpcHsts(await handleGetOrHeadInner(req, context, isHead), req)
}

const traceAttributes = async (
  _req: NextRequest,
  context: { params: Promise<Params> }
) => {
  const { nsid: segments } = await context.params
  const nsid = getSingleNsid(segments)
  return nsid && isValidNsid(nsid) ? { nsid } : {}
}

export const OPTIONS = async (
  req: NextRequest,
  context: { params: Promise<Params> }
): Promise<Response> => {
  if (!getPdsConfig()) {
    return withXrpcHsts(xrpcNotFoundResponse(), req)
  }
  await ensureServedDomainsFresh()
  const pdsDomain = getPdsDomainForRequest(req.headers)
  if (!pdsDomain) {
    return withXrpcHsts(xrpcNotFoundResponse(), req)
  }
  const { nsid: segments } = await context.params
  if (!getSingleNsid(segments)) {
    return withXrpcHsts(xrpcInvalidPathResponse(), req)
  }
  return withXrpcHsts(xrpcOptionsResponse(), req)
}

export const GET = traceApiRoute<Params>(
  'xrpcGet',
  (req, context) => handleGetOrHead(req, context, false),
  { addAttributes: traceAttributes }
)

export const HEAD = traceApiRoute<Params>(
  'xrpcHead',
  (req, context) => handleGetOrHead(req, context, true),
  { addAttributes: traceAttributes }
)

export const POST = traceApiRoute<Params>(
  'xrpcPost',
  async (req, context) => {
    const pdsDomain = getPdsDomainForRequest(req.headers)
    if (!pdsDomain) {
      return withXrpcHsts(xrpcNotFoundResponse(), req)
    }
    const { nsid: segments } = await context.params
    const nsid = getSingleNsid(segments)
    if (!nsid) {
      return withXrpcHsts(xrpcInvalidPathResponse(), req)
    }
    if (getPdsXrpcDispatchEntry('GET', nsid)?.category === 'public-read') {
      return withXrpcHsts(
        xrpcMethodNotAllowedResponse('GET, HEAD, OPTIONS'),
        req
      )
    }
    return withXrpcHsts(xrpcMethodNotImplementedResponse(), req)
  },
  { addAttributes: traceAttributes }
)

const handleUnsupportedMethod = async (
  req: NextRequest,
  context: { params: Promise<Params> }
): Promise<Response> => {
  if (!getPdsConfig()) {
    return withXrpcHsts(xrpcNotFoundResponse(), req)
  }
  await ensureServedDomainsFresh()
  const pdsDomain = getPdsDomainForRequest(req.headers)
  if (!pdsDomain) {
    return withXrpcHsts(xrpcNotFoundResponse(), req)
  }
  const { nsid: segments } = await context.params
  if (!getSingleNsid(segments)) {
    return withXrpcHsts(xrpcInvalidPathResponse(), req)
  }
  return withXrpcHsts(
    xrpcMethodNotAllowedResponse('GET, POST, HEAD, OPTIONS'),
    req
  )
}

export const PUT = handleUnsupportedMethod
export const DELETE = handleUnsupportedMethod
export const PATCH = handleUnsupportedMethod
