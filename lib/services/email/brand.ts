import { buildBaseURL, getBaseURL, getConfig } from '@/lib/config'

/**
 * Whose name an email carries: the visited or recipient domain's identity
 * (`resolveDomainIdentity`). Optional everywhere; without it an email reads
 * as the primary host's, as it always did.
 */
export interface EmailBrand {
  /** The wordmark, the domain's name (Admin › Served domains, else Admin › Server settings). */
  name: string
  /** The domain the email's header, links and copy name. */
  domain: string
}

/** The host the email names: the brand's domain, else the primary host. */
export const brandHost = (brand?: EmailBrand | null): string =>
  brand?.domain || getConfig().host

/** The origin links are built on: the brand's domain, else the primary. */
export const brandBaseURL = (brand?: EmailBrand | null): string =>
  brand?.domain ? buildBaseURL(brand.domain) : getBaseURL()
