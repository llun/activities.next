import type { Database } from '@/lib/database/types'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { FederationPolicyUnavailableError } from '@/lib/services/federation/policyUnavailable'
import { BLUESKY_DOMAIN } from '@/lib/utils/blueskyId'

export const BLUESKY_NOT_ALLOWED_MESSAGE = 'This server does not allow Bluesky.'

export const isBlueskyAllowed = async (
  database: Database
): Promise<boolean> => {
  try {
    return await canFederateWithDomain(database, BLUESKY_DOMAIN)
  } catch (error) {
    if (error instanceof FederationPolicyUnavailableError) return false
    throw error
  }
}
