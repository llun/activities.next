import { trace } from '@opentelemetry/api'

import { compactActivityPub } from '@/lib/activities/jsonld'
import { StatusActivity } from '@/lib/activities/statusAction'
import { RELAY_ANNOUNCE_JOB_NAME } from '@/lib/jobs/names'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { ActivityPubVerifySenderGuard } from '@/lib/services/guards/ActivityPubVerifyGuard'
import { annotateInboxRejection } from '@/lib/services/guards/inboxRejectionTrace'
import { getQueue } from '@/lib/services/queue'
import { AnnounceAction } from '@/lib/types/activitypub/activities'
import { extractActivityPubId, normalizeActorId } from '@/lib/utils/activitypub'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  DEFAULT_202,
  ERROR_400,
  ERROR_403,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { isRecord } from '@/lib/utils/typeGuards'

import { getJobMessage } from './getJobMessage'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'sharedInbox',
  ActivityPubVerifySenderGuard(
    async (request, { activityBody, database, verifiedSenderActorId }) => {
      try {
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
          annotateInboxRejection('invalid_activity_body', {
            sender_actor_id: verifiedSenderActorId
          })
          return apiResponse({
            req: request,
            allowedMethods: CORS_HEADERS,
            data: ERROR_400,
            responseStatusCode: 400
          })
        }
        const activity = { ...body, actor } as unknown as StatusActivity
        if (!(await canFederateWithDomain(database, activity.actor))) {
          annotateInboxRejection('domain_not_federatable', {
            actor_id: activity.actor,
            sender_actor_id: verifiedSenderActorId
          })
          return apiResponse({
            req: request,
            allowedMethods: CORS_HEADERS,
            data: ERROR_403,
            responseStatusCode: 403
          })
        }

        // Swallow activities from a suspended remote actor: acknowledge with 202
        // but never queue them. A 403 would leak the moderation decision back to
        // the sender.
        const senderStates = await database.getModerationStatesForActors({
          actorIds: [verifiedSenderActorId]
        })
        if (senderStates.get(verifiedSenderActorId)?.suspendedAt) {
          return apiResponse({
            req: request,
            allowedMethods: CORS_HEADERS,
            data: DEFAULT_202,
            responseStatusCode: 202
          })
        }

        // A relay forwards third-party posts as an Announce signed by the relay
        // itself (so the signer === actor check already passed). When the verified
        // sender is an accepted relay, route its Announce to the relay-ingest job
        // (which re-fetches the wrapped note from origin and federates it) instead
        // of the normal boost path — we never want a relay-attributed Announce row.
        if (activity.type === AnnounceAction) {
          const relay = await database.getRelayByActorId({
            actorId: verifiedSenderActorId
          })
          // Any Announce from a KNOWN relay is relay traffic, never a normal
          // boost. Accepted relays are ingested into the Federated timeline; a
          // known-but-not-accepted relay (pending/rejected/unsubscribed) is
          // acknowledged without falling through to the boost path, so it can
          // never create a relay-attributed Announce row.
          if (relay) {
            if (relay.state === 'accepted') {
              await getQueue().publish({
                id: getHashFromString(activity.id),
                name: RELAY_ANNOUNCE_JOB_NAME,
                data: activity
              })
            }
            return apiResponse({
              req: request,
              allowedMethods: CORS_HEADERS,
              data: DEFAULT_202,
              responseStatusCode: 202
            })
          }
        }

        const jobMessage = getJobMessage(activity, verifiedSenderActorId)
        if (!jobMessage) {
          annotateInboxRejection('unsupported_activity_shape', {
            activity_id: activity.id,
            activity_type: activity.type,
            sender_actor_id: verifiedSenderActorId
          })
          return apiResponse({
            req: request,
            allowedMethods: CORS_HEADERS,
            data: DEFAULT_202,
            responseStatusCode: 202
          })
        }

        await getQueue().publish(jobMessage)
        return apiResponse({
          req: request,
          allowedMethods: CORS_HEADERS,
          data: DEFAULT_202,
          responseStatusCode: 202
        })
      } catch (error) {
        const span = trace.getActiveSpan()
        const err = error instanceof Error ? error : new Error(String(error))
        span?.recordException(err)
        annotateInboxRejection('handler_exception', {
          sender_actor_id: verifiedSenderActorId
        })
        logger.error({
          err: toLoggableError(error),
          message: 'Shared inbox handler threw',
          senderActorId: verifiedSenderActorId
        })
        return apiResponse({
          req: request,
          allowedMethods: CORS_HEADERS,
          data: ERROR_400,
          responseStatusCode: 400
        })
      }
    },
    CORS_HEADERS
  )
)
