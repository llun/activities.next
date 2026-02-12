import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

import { DEFAULT_QUOTA_PER_ACCOUNT } from './constants'

export const getQuotaLimit = (): number => {
  const config = getConfig()
  return (
    config.fitnessStorage?.quotaPerAccount ??
    config.mediaStorage?.quotaPerAccount ??
    DEFAULT_QUOTA_PER_ACCOUNT
  )
}

export const checkQuotaAvailable = async (
  database: Database,
  actor: Actor,
  requiredBytes: number
): Promise<{ available: boolean; used: number; limit: number }> => {
  const limit = getQuotaLimit()

  // Get the accountId from the actor
  const actorData = await database.getActorFromId({ id: actor.id })
  const accountId = actorData?.account?.id
  if (!accountId) {
    return { available: false, used: 0, limit }
  }

  const [mediaUsed, fitnessUsed] = await Promise.all([
    database.getStorageUsageForAccount({
      accountId
    }),
    database.getFitnessStorageUsageForAccount({
      accountId
    })
  ])

  const used = mediaUsed + fitnessUsed

  const available = used + requiredBytes <= limit
  return { available, used, limit }
}
