import { NextRequest } from 'next/server'

import { SERVICE_NAME } from '@/lib/constants'
import {
  type AcceptedContentType,
  parseAcceptContentTypes
} from '@/lib/utils/acceptContentTypes'
import { ACTIVITY_STREAM_URL } from '@/lib/utils/activitystream'
import { HttpMethod } from '@/lib/utils/http-headers'
import { apiResponse } from '@/lib/utils/response'

export const ACTIVITYPUB_CONTENT_TYPE = 'application/activity+json'
export const ACTIVITYSTREAM_LD_CONTENT_TYPE = `application/ld+json; profile="${ACTIVITY_STREAM_URL}"`
export const JSON_CONTENT_TYPE = 'application/json'

type ActivityPubCandidate = {
  accepted: AcceptedContentType
  responseContentType: string
}

const isActivityStreamsProfile = (profile: string | undefined) => {
  if (profile === undefined) return true
  const trimmed = profile.trim()
  if (!trimmed) return false

  return trimmed.split(/\s+/).includes(ACTIVITY_STREAM_URL)
}

const isHtmlType = ({ type }: AcceptedContentType) =>
  type === 'text/html' || type === 'application/xhtml+xml'

const isMorePreferred = (
  left: AcceptedContentType,
  right: AcceptedContentType
) => {
  if (left.quality !== right.quality) return left.quality > right.quality
  if (left.specificity !== right.specificity) {
    return left.specificity > right.specificity
  }

  return left.index < right.index
}

const getActivityPubCandidate = (
  accepted: AcceptedContentType
): ActivityPubCandidate | null => {
  if (accepted.type === ACTIVITYPUB_CONTENT_TYPE) {
    return {
      accepted,
      responseContentType: ACTIVITYPUB_CONTENT_TYPE
    }
  }

  if (
    accepted.type === 'application/ld+json' &&
    isActivityStreamsProfile(accepted.parameters.profile)
  ) {
    return {
      accepted,
      responseContentType: ACTIVITYSTREAM_LD_CONTENT_TYPE
    }
  }

  if (accepted.type === JSON_CONTENT_TYPE) {
    return {
      accepted,
      responseContentType: JSON_CONTENT_TYPE
    }
  }

  if (accepted.type === 'application/*' || accepted.type === '*/*') {
    return {
      accepted,
      responseContentType: ACTIVITYPUB_CONTENT_TYPE
    }
  }

  return null
}

export const negotiateActivityPubContentType = (
  acceptHeaderValue: string | null
) => {
  if (!acceptHeaderValue?.trim()) return ACTIVITYPUB_CONTENT_TYPE

  const acceptedContentTypes = parseAcceptContentTypes(acceptHeaderValue)
  const activityPubCandidate = acceptedContentTypes
    .map(getActivityPubCandidate)
    .find((candidate): candidate is ActivityPubCandidate => candidate !== null)

  if (!activityPubCandidate) return null

  const htmlCandidate = acceptedContentTypes.find(isHtmlType)
  if (
    htmlCandidate &&
    isMorePreferred(htmlCandidate, activityPubCandidate.accepted)
  ) {
    return null
  }

  return activityPubCandidate.responseContentType
}

export const activityPubResponse = ({
  req,
  data,
  contentType,
  allowedMethods = [HttpMethod.enum.GET]
}: {
  req: NextRequest
  data: unknown
  contentType?: string | null
  allowedMethods?: HttpMethod[]
}) => {
  const responseContentType =
    contentType ??
    negotiateActivityPubContentType(req.headers.get('accept')) ??
    ACTIVITYPUB_CONTENT_TYPE

  return apiResponse({
    req,
    allowedMethods,
    data,
    additionalHeaders: [
      ['Content-Type', responseContentType],
      ['Vary', 'Accept']
    ]
  })
}

export const activityPubRedirectResponse = (url: string) => {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      Server: SERVICE_NAME,
      Vary: 'Accept'
    }
  })
}
