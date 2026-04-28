import { DEFAULT_ACCEPT } from '@/lib/activities/constants'
import { Actor } from '@/lib/types/domain/actor'
import { signedHeaders } from '@/lib/utils/signature'

type ActivityPubMethod = 'GET' | 'POST'

interface ActivityPubRequestHeadersParams {
  url: string
  method?: ActivityPubMethod
  signingActor?: Actor | null
  content?: unknown
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
  Accept: accept
})
