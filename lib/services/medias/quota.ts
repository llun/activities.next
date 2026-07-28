import { getConfig } from '@/lib/config'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'

import { DEFAULT_QUOTA_PER_ACCOUNT } from './constants'
import type { MediaSchema } from './types'

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

// What one upload should reserve. `createMedia` meters the original's UPLOADED
// bytes plus the thumbnail's STORED bytes, so this is best-effort rather than
// exact: a lossy JPEG can re-encode into a near-lossless WebP larger than it
// arrived as. Reserving nothing for the thumbnail was worse — an upload that
// fits only without it was accepted and left the account over its quota. The
// original under-counts the same way, and always has.
export const getUploadQuotaReservation = (media: MediaSchema) =>
  media.file.size + (media.thumbnail?.size ?? 0)
