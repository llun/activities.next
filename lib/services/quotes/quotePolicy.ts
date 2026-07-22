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
 */
export const getEffectiveQuoteApprovalPolicy = (
  status: PolicyStatus
): QuoteApprovalPolicy => {
  if (status.quoteApprovalPolicy) return status.quoteApprovalPolicy
  const visibility = getVisibility(status.to, status.cc)
  return visibility === 'public' || visibility === 'unlisted'
    ? 'public'
    : 'nobody'
}
