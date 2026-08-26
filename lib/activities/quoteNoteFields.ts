import { getEffectiveQuoteApprovalPolicy } from '@/lib/services/quotes/quotePolicy'
import type {
  QuoteApprovalPolicy,
  StatusQuote
} from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

/**
 * The FEP-044f quote fields a note carries, or `null` when it quotes nothing.
 *
 * The quote target is advertised while the edge is live (pending or accepted)
 * under every compat alias — Mastodon `quote`/`quoteUrl`, Fedibird `quoteUri`,
 * Misskey `_misskey_quote` — because receivers read whichever their dialect
 * knows. The hosted stamp uri rides along only on an accepted edge: it is the
 * proof of approval, so emitting it for anything else would advertise consent
 * the quoted author never gave.
 *
 * Shared by `getNoteFromStatus` (delivery) and `toActivityPubObject` (the AP
 * GET/outbox/replies surfaces) so a note describes its quote identically
 * whether a peer was handed it or fetched it. Any surface emitting these fields
 * must declare `QUOTE_ACTIVITY_CONTEXT`, or a receiver that compacts the
 * document drops every one of them.
 */
export const getQuoteNoteFields = (
  quoteEdge: StatusQuote | null | undefined
) => {
  if (!quoteEdge) return null
  if (quoteEdge.state !== 'pending' && quoteEdge.state !== 'accepted') {
    return null
  }

  const quoteTargetId = quoteEdge.quotedStatusId
  const quoteAuthorization =
    quoteEdge.state === 'accepted'
      ? (quoteEdge.authorizationUri ?? undefined)
      : undefined

  return {
    quote: quoteTargetId,
    quoteUrl: quoteTargetId,
    quoteUri: quoteTargetId,
    _misskey_quote: quoteTargetId,
    ...(quoteAuthorization ? { quoteAuthorization } : null)
  }
}

// Advertise the audiences that may quote a status. `public` → the public
// collection; `followers` → the author's followers collection; `nobody` → only
// the author. Manual-approval queues are not modelled, so manualApproval is [].
const buildCanQuote = (policy: QuoteApprovalPolicy, actorId: string) => {
  const automaticApproval =
    policy === 'public'
      ? [ACTIVITY_STREAM_PUBLIC]
      : policy === 'followers'
        ? [`${actorId}/followers`]
        : [actorId]
  return { automaticApproval, manualApproval: [] as string[] }
}

type InteractionPolicyStatus = {
  actorId: string
  to: string[]
  cc: string[]
  quoteApprovalPolicy?: QuoteApprovalPolicy
}

/**
 * Who may quote THIS status (FEP-044f `interactionPolicy.canQuote`). Emitted
 * unconditionally: a peer cannot honour a quote policy it was never told, and
 * the answer is meaningful for every status, quoting or not.
 *
 * Shared for the same reason `getQuoteNoteFields` is — a peer that learns a
 * status by FETCHING it (a URL search, resolving an `inReplyTo` ancestor,
 * walking our `/replies` collection) must be told the same policy as one that
 * received it over an inbox delivery. Nothing reads this inbound locally, so a
 * divergence here is invisible to every test and only shows up as a remote
 * server allowing or refusing a quote it should not have.
 */
export const getInteractionPolicyFields = (
  status: InteractionPolicyStatus
) => ({
  interactionPolicy: {
    canQuote: buildCanQuote(
      getEffectiveQuoteApprovalPolicy(status),
      status.actorId
    )
  }
})
