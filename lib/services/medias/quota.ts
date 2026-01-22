import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/models/actor'

import { DEFAULT_QUOTA_PER_ACCOUNT } from './constants'

export const getQuotaLimit = (): number => {
  const config = getConfig()
  return config.mediaStorage?.quotaPerAccount ?? DEFAULT_QUOTA_PER_ACCOUNT
}

export const checkQuotaAvailable = async (
  database: Database,
  actor: Actor,
  requiredBytes: number
): Promise<{ available: boolean; used: number; limit: number }> => {
  // Get the accountId from the actor
  const actorData = await database.getActorFromId({ id: actor.id })
  if (!actorData?.account?.id) {
    return { available: false, used: 0, limit: 0 }
  }

  const limit = getQuotaLimit()
  const used = await database.getStorageUsageForAccount({
    accountId: actorData.account.id
  })

  const available = used + requiredBytes <= limit
  return { available, used, limit }
}
