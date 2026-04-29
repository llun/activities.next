import { DEFAULT_ACCEPT } from '@/lib/activities/constants'
import { Actor } from '@/lib/types/domain/actor'
import { type SignedHttpMethod, signedHeaders } from '@/lib/utils/signature'

type ActivityPubRequestContent = object

interface ActivityPubRequestHeadersParams {
  url: string
  method?: SignedHttpMethod
  signingActor?: Actor | null
  content?: ActivityPubRequestContent
  accept?: string
}

export const activityPubRequestHeaders = ({
  url,
  method = 'GET',
  signingActor,
  content,
  accept = DEFAULT_ACCEPT
}: ActivityPubRequestHeadersParams): Record<string, string> => ({
  ...(signingActor ? signedHeaders(signingActor, method, url, content) : {}),
  accept
})
