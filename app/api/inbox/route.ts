import { compactActivityPub } from '@/lib/activities/jsonld'
import { StatusActivity } from '@/lib/activities/statusAction'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { ActivityPubVerifySenderGuard } from '@/lib/services/guards/ActivityPubVerifyGuard'
import { getQueue } from '@/lib/services/queue'
import { extractActivityPubId, normalizeActorId } from '@/lib/utils/activitypub'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  DEFAULT_202,
  ERROR_400,
  ERROR_403,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { isRecord } from '@/lib/utils/typeGuards'

import { getJobMessage } from './getJobMessage'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'sharedInbox',
  ActivityPubVerifySenderGuard(
    async (request, { activityBody, database, verifiedSenderActorId }) => {
      // Canonicalise the activity (and its embedded object) via JSON-LD
      // compaction before matching on `type`/`object.type`, so dialect
      // variations (array/IRI types, single vs array recipients, inline id
      // references) collapse to the predictable shape the job matcher expects.
      const body = await compactActivityPub(activityBody)
      // Validate the sender identity from the original (pre-compaction) body. A
      // malformed `actor` (empty string, number, bare object) must be rejected
      // as a bad request rather than turned into a relative-reference artifact
      // (e.g. `./`) by compaction's IRI resolution.
      const actor = isRecord(activityBody)
        ? extractActivityPubId(activityBody.actor)
        : undefined

      // The guard enforces signed POST actors; keep route validation before casting unknown JSON.
      if (
        !isRecord(body) ||
        typeof body.id !== 'string' ||
        typeof body.type !== 'string' ||
        !actor ||
        !normalizeActorId(actor)
      ) {
        return apiResponse({
          req: request,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }
      const activity = { ...body, actor } as unknown as StatusActivity
      if (!(await canFederateWithDomain(database, activity.actor))) {
        return apiResponse({
          req: request,
          allowedMethods: CORS_HEADERS,
          data: ERROR_403,
          responseStatusCode: 403
        })
      }

      const jobMessage = getJobMessage(activity, verifiedSenderActorId)
      if (!jobMessage) {
        return apiResponse({
          req: request,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }

      await getQueue().publish(jobMessage)
      return apiResponse({
        req: request,
        allowedMethods: CORS_HEADERS,
        data: DEFAULT_202,
        responseStatusCode: 202
      })
    },
    CORS_HEADERS
  )
)
