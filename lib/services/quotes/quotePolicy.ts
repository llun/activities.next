import { QuoteApprovalPolicy } from '@/lib/types/domain/status'
import { getVisibility } from '@/lib/utils/getVisibility'

type PolicyStatus = {
  to: string[]
  cc: string[]
  quoteApprovalPolicy?: QuoteApprovalPolicy
}

/**
 * The effective quote-approval policy for a status: its explicit
 * `quoteApprovalPolicy` when set, otherwise a visibility-derived default.
 * Public/unlisted posts are publicly quotable by default; non-public posts
 * (followers-only / direct) default to `nobody` (author only) — the author has
 * not opted into wider quoting, so we must not treat their private post as
 * freely quotable.
 *
 * An explicit policy is also clamped to the post's own audience, because a
 * policy wider than who can read the post is meaningless and dangerous: the
 * web composer sends `public` for every post it creates, and an inbound
 * QuoteRequest is approved on policy alone. A followers-only post is quotable
 * by followers at most; a direct post only by its author.
 */
export const getEffectiveQuoteApprovalPolicy = (
  status: PolicyStatus
): QuoteApprovalPolicy => {
  const visibility = getVisibility(status.to, status.cc)
  if (visibility === 'direct') return 'nobody'
  if (visibility === 'private') {
    return status.quoteApprovalPolicy === 'followers' ? 'followers' : 'nobody'
  }
  return status.quoteApprovalPolicy ?? 'public'
}
