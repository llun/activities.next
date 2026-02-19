import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { DEFAULT_QUOTA_PER_ACCOUNT } from '@/lib/services/medias/constants'
import { Actor } from '@/lib/types/domain/actor'

export const getFitnessQuotaLimit = (): number => {
  const config = getConfig()
  return (
    config.fitnessStorage?.quotaPerAccount ??
    config.mediaStorage?.quotaPerAccount ??
    DEFAULT_QUOTA_PER_ACCOUNT
  )
}

export async function checkFitnessQuotaAvailable(
  database: Database,
  actor: Actor,
  requiredBytes: number
): Promise<{ available: boolean; used: number; limit: number }> {
  // Use the same quota as media storage (shared quota)
  const quotaLimit = getFitnessQuotaLimit()

  const actorData = await database.getActorFromId({ id: actor.id })
  const accountId = actorData?.account?.id
  if (!accountId) {
    return { available: false, used: 0, limit: quotaLimit }
  }

  const [mediaUsed, fitnessUsed] = await Promise.all([
    database.getStorageUsageForAccount({ accountId }),
    database.getFitnessStorageUsageForAccount({ accountId })
  ])

  const totalUsed = mediaUsed + fitnessUsed
  const available = totalUsed + requiredBytes <= quotaLimit

  return {
    available,
    used: totalUsed,
    limit: quotaLimit
  }
}
