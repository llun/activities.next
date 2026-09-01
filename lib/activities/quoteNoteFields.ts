import { getEffectiveQuoteApprovalPolicy } from '@/lib/services/quotes/quotePolicy'
import type {
  QuoteApprovalPolicy,
  StatusQuote
} from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'

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

const QUOTE_INLINE_CLASS = 'quote-inline'

/**
 * Mastodon-compatible legacy fallback: prepend
 * `<p class="quote-inline">RE: <a href="…">…</a></p>` to a quoting note's
 * content so receivers that do not understand the FEP-044f quote fields still
 * show a link to the quoted post. Mirrors Mastodon's
 * TextFormatter#add_quote_fallback: added only while the quote fields
 * themselves are emitted (the `getQuoteNoteFields` gate, shared by
 * construction), and skipped when the content already contains the quoted
 * url — which also stops a boosted remote quote post from being
 * double-prefixed, since its origin server's fallback already carries the url.
 * Receivers that DO understand quotes hide the `quote-inline` element, as
 * `post.tsx` does whenever it renders a quote card.
 */
export const addQuoteFallbackToContent = (
  content: string,
  quoteEdge: StatusQuote | null | undefined
): string => {
  const fields = getQuoteNoteFields(quoteEdge)
  if (!fields) return content
  const url = fields.quote
  if (!url) return content
  // The skip must test the ESCAPED form too: stored HTML only ever carries
  // the escaped rendering of the url (`&` as `&amp;`), so matching the raw
  // form alone double-prefixed a boosted remote quote post whose id contains
  // an escapable character.
  const escaped = escapeHtml(url)
  if (content.includes(url) || content.includes(escaped)) return content
  return `<p class="${QUOTE_INLINE_CLASS}">RE: <a href="${escaped}">${escaped}</a></p>${content}`
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
