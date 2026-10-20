import type { DomainIdentity } from '@/lib/services/domains/domainIdentity'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { renderPolicyMarkdown } from '@/lib/utils/text/renderPolicyMarkdown'

// The Mastodon entities for the visited domain's terms of service and privacy
// policy. Each returns null when the document is not set, and the routes
// answer 404 then: Mastodon's "Record not found" for terms of service, and a
// deliberate deviation for the privacy policy (Mastodon serves a bundled
// default policy; this server ships none).
//
// Only one version of each document is kept, so a document's date is when its
// text last changed, or the epoch when it has none (an env-pinned document).

// https://docs.joinmastodon.org/entities/TermsOfService/ (Mastodon 4.4.0).
// Never superseded: there is no version history.
export const getTermsOfServiceEntity = (identity: DomainIdentity) => {
  const document = identity.termsOfService
  if (!document) return null

  return {
    effective_date: getISOTimeUTC(document.updatedAt ?? 0, true),
    effective: true,
    content: renderPolicyMarkdown(document.markdown, {
      domain: identity.domain
    }),
    succeeded_by: null
  }
}

// https://docs.joinmastodon.org/entities/PrivacyPolicy/
export const getPrivacyPolicyEntity = (identity: DomainIdentity) => {
  const document = identity.privacyPolicy
  if (!document) return null

  return {
    updated_at: getISOTimeUTC(document.updatedAt ?? 0),
    content: renderPolicyMarkdown(document.markdown, {
      domain: identity.domain
    })
  }
}
