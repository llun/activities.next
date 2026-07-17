import { Database } from '@/lib/database/types'
import { FollowStatus } from '@/lib/types/domain/follow'
import {
  QuoteApprovalPolicy,
  Status,
  getOriginalStatus
} from '@/lib/types/domain/status'

// The policy verdict for a quote attempt. `automatic` means the quote is
// approved without a manual step; `denied` means it must not be approved.
export type QuoteVerdict = 'automatic' | 'denied'

type CanQuoteStatusParams = {
  database: Database
  // The status being quoted.
  quotedStatus: Status
  // The actor attempting to quote it.
  quotingActorId: string
}

/**
 * Pure policy verdict for whether `quotingActorId` may quote `quotedStatus`,
 * from the quoted status's `quoteApprovalPolicy` plus block/follow relations.
 * Shared by the create route, the inbound QuoteRequest handler, and the
 * quote_approval `current_user` computation.
 *
 * - self-quote → `automatic`;
 * - either party blocks the other → `denied`;
 * - policy `public` → `automatic`; `nobody` → `denied`;
 * - policy `followers` → `automatic` iff the quoter has an *accepted* follow of
 *   the quoted author (a merely-requested follow is not enough).
 */
export const canQuoteStatus = async ({
  database,
  quotedStatus,
  quotingActorId
}: CanQuoteStatusParams): Promise<QuoteVerdict> => {
  const quoted = getOriginalStatus(quotedStatus)
  const quotedAuthorId = quoted.actorId

  if (quotedAuthorId === quotingActorId) return 'automatic'

  if (
    await database.isEitherBlocking({
      actorIdA: quotingActorId,
      actorIdB: quotedAuthorId
    })
  ) {
    return 'denied'
  }

  const policy: QuoteApprovalPolicy = quoted.quoteApprovalPolicy ?? 'public'
  switch (policy) {
    case 'public':
      return 'automatic'
    case 'nobody':
      return 'denied'
    case 'followers': {
      const follow = await database.getAcceptedOrRequestedFollow({
        actorId: quotingActorId,
        targetActorId: quotedAuthorId
      })
      return follow?.status === FollowStatus.enum.Accepted
        ? 'automatic'
        : 'denied'
    }
  }
}
