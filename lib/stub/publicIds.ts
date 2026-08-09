import { Database } from '@/lib/database/types'

// Test helpers for the emission flip: every seeded status/actor gets a
// DB-minted UUIDv7 publicId, so response assertions read the expected id off
// the stored row instead of hard-coding a literal uuid (they are random per
// run). Both helpers throw when the row is missing or has no publicId so a
// mis-seeded fixture fails loudly instead of comparing `undefined` to
// `undefined`.

export const statusPublicId = async (
  database: Database,
  statusId: string
): Promise<string> => {
  const publicIds = await database.getStatusPublicIds({ statusIds: [statusId] })
  const publicId = publicIds.get(statusId)
  if (!publicId) {
    throw new Error(`No publicId stored for status ${statusId}`)
  }
  return publicId
}

export const actorPublicId = async (
  database: Database,
  actorId: string
): Promise<string> => {
  const publicIds = await database.getActorPublicIds({ actorIds: [actorId] })
  const publicId = publicIds.get(actorId)
  if (!publicId) {
    throw new Error(`No publicId stored for actor ${actorId}`)
  }
  return publicId
}
