import type { StatusQuote } from '@/lib/types/domain/status'

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
