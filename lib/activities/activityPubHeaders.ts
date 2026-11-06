import { DEFAULT_ACCEPT } from '@/lib/activities/constants'
import { Actor } from '@/lib/types/domain/actor'
import { type SignedHttpMethod, signedHeaders } from '@/lib/utils/signature'

interface ActivityPubRequestHeadersParams {
  url: string
  method?: SignedHttpMethod
  signingActor?: Actor | null
  /** The serialized request body, exactly as it is sent. */
  body?: string
  accept?: string
}

export const activityPubRequestHeaders = ({
  url,
  method = 'GET',
  signingActor,
  body,
  accept = DEFAULT_ACCEPT
}: ActivityPubRequestHeadersParams): Record<string, string> => ({
  ...(signingActor ? signedHeaders(signingActor, method, url, body) : {}),
  accept
})
