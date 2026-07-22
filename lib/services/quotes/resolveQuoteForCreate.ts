import { Database } from '@/lib/database/types'
import { canQuoteStatus } from '@/lib/services/quotes/canQuoteStatus'
import { canActorReadStatus } from '@/lib/services/statusAccess'
import { Actor } from '@/lib/types/domain/actor'
import { QuoteApprovalPolicy } from '@/lib/types/domain/status'

type ResolveQuoteForCreateParams = {
  database: Database
  currentActor: Actor
  // The canonical quoted status URL id (callers that receive an opaque/encoded
  // id must decode it with idToUrl first), if any.
  quotedStatusId?: string
  // The client-supplied quote_approval_policy for the NEW status, if any.
  requestedPolicy?: QuoteApprovalPolicy
}

export type ResolveQuoteForCreateResult =
  | {
      ok: true
      // Canonical quoted status URL id (undefined when nothing is quoted).
      quotedStatusId?: string
      // Effective policy for the new status: the requested value, else the
      // actor's default (undefined leaves the per-status visibility fallback).
      quoteApprovalPolicy?: QuoteApprovalPolicy
    }
  | { ok: false; reason: 'not_found' | 'denied' }

/**
 * Shared quote authorization + policy defaulting for the status-create paths.
 * When a quote target is supplied it must be readable by the caller (else
 * `not_found`) and its author's policy must permit the quote (else `denied`),
 * mirroring `POST /api/v1/statuses`. The new status's own quote-approval policy
 * defaults to the actor's `defaultQuotePolicy` when the caller omits it.
 */
export const resolveQuoteForCreate = async ({
  database,
  currentActor,
  quotedStatusId: quotedStatusIdInput,
  requestedPolicy
}: ResolveQuoteForCreateParams): Promise<ResolveQuoteForCreateResult> => {
  let quotedStatusId: string | undefined
  if (quotedStatusIdInput) {
    const quotedStatus = await database.getStatus({
      statusId: quotedStatusIdInput,
      withReplies: false
    })
    if (
      !quotedStatus ||
      !(await canActorReadStatus({
        database,
        status: quotedStatus,
        currentActor
      }))
    ) {
      return { ok: false, reason: 'not_found' }
    }
    const verdict = await canQuoteStatus({
      database,
      quotedStatus,
      quotingActorId: currentActor.id
    })
    if (verdict === 'denied') return { ok: false, reason: 'denied' }
    quotedStatusId = quotedStatusIdInput
  }

  const quoteApprovalPolicy =
    requestedPolicy ??
    (await database.getActorSettings({ actorId: currentActor.id }))
      ?.defaultQuotePolicy

  return { ok: true, quotedStatusId, quoteApprovalPolicy }
}
