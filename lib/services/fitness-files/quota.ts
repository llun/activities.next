import { getConfig } from '@/lib/config'
import { DEFAULT_QUOTA_PER_ACCOUNT } from '@/lib/services/medias/constants'
import { Actor } from '@/lib/types/domain/actor'

import { CounterKey, getCounterValue } from '../../database/sql/utils/counter'
import { Database } from '../../database/types'

export async function checkFitnessQuotaAvailable(
  database: Database,
  actor: Actor,
  requiredBytes: number
): Promise<{ available: boolean; used: number; limit: number }> {
  const config = getConfig()

  // Use the same quota as media storage (shared quota)
  const quotaLimit =
    config.fitnessStorage?.quotaPerAccount ??
    config.mediaStorage?.quotaPerAccount ??
    DEFAULT_QUOTA_PER_ACCOUNT

  // Get both media and fitness usage
  const account = await database.getAccountForActorId(actor.id)
  if (!account) {
    return { available: false, used: 0, limit: quotaLimit }
  }

  const knexInstance = database['knex'] ?? database
  const mediaUsageKey = CounterKey.mediaUsage(account.id)
  const fitnessUsageKey = CounterKey.fitnessUsage(account.id)

  const [mediaUsed, fitnessUsed] = await Promise.all([
    getCounterValue(knexInstance, mediaUsageKey),
    getCounterValue(knexInstance, fitnessUsageKey)
  ])

  const totalUsed = mediaUsed + fitnessUsed
  const available = totalUsed + requiredBytes <= quotaLimit

  return {
    available,
    used: totalUsed,
    limit: quotaLimit
  }
}
