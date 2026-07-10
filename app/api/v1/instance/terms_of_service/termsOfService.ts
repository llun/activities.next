import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { escapeHtml } from '@/lib/utils/text/escapeHtml'

// The server keeps a single, undated terms-of-service text in config, so the
// entity always reports the epoch as its effective date — mirroring
// extended_description, which reports the epoch as updated_at — and is never
// superseded (succeeded_by stays null).
export const TERMS_OF_SERVICE_EFFECTIVE_DATE = getISOTimeUTC(0, true)

// https://docs.joinmastodon.org/entities/TermsOfService/ (added in Mastodon
// 4.4.0). Returns null when no terms are configured; callers 404 like
// Mastodon's "Record not found".
export const getTermsOfServiceEntity = (config: {
  termsOfService?: string | null
}) => {
  const content = config.termsOfService
  if (!content) return null

  return {
    effective_date: TERMS_OF_SERVICE_EFFECTIVE_DATE,
    effective: true,
    content: `<p>${escapeHtml(content)}</p>`,
    succeeded_by: null
  }
}
