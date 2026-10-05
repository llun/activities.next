import { getEffectiveQuoteApprovalPolicy } from '@/lib/services/quotes/quotePolicy'
import { QuoteApprovalPolicy } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

const AUTHOR = 'https://llun.test/users/alice'
const FOLLOWERS = `${AUTHOR}/followers`
const RECIPIENT = 'https://remote.test/users/bob'

const audiences = {
  public: { to: [ACTIVITY_STREAM_PUBLIC], cc: [FOLLOWERS] },
  unlisted: { to: [FOLLOWERS], cc: [ACTIVITY_STREAM_PUBLIC] },
  private: { to: [FOLLOWERS], cc: [] },
  direct: { to: [RECIPIENT], cc: [] }
}

describe('getEffectiveQuoteApprovalPolicy', () => {
  it.each([
    // Unset: visibility-derived default.
    ['public', undefined, 'public'],
    ['unlisted', undefined, 'public'],
    ['private', undefined, 'nobody'],
    ['direct', undefined, 'nobody'],
    // Explicit policy on a public/unlisted post is honoured as-is.
    ['public', 'followers', 'followers'],
    ['unlisted', 'nobody', 'nobody'],
    // Explicit policy is clamped to a non-public post's audience: the web
    // composer sends `public` for every post, which must not make a
    // followers-only or direct post quotable by anyone.
    ['private', 'public', 'nobody'],
    ['private', 'followers', 'followers'],
    ['private', 'nobody', 'nobody'],
    ['direct', 'public', 'nobody'],
    ['direct', 'followers', 'nobody']
  ] as const)(
    '%s post with policy %s → %s',
    (visibility, quoteApprovalPolicy, expected) => {
      expect(
        getEffectiveQuoteApprovalPolicy({
          ...audiences[visibility],
          quoteApprovalPolicy: quoteApprovalPolicy as
            QuoteApprovalPolicy | undefined
        })
      ).toBe(expected)
    }
  )
})
