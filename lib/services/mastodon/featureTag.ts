import { Database } from '@/lib/database/types'
import { FeaturedTagWithStats } from '@/lib/types/database/operations'

// Mastodon caps featured tags per account at FeaturedTag::LIMIT = 10.
export const FEATURED_TAGS_LIMIT = 10

export type FeatureTagResult =
  | { status: 'featured'; tag: FeaturedTagWithStats }
  | { status: 'limit_reached' }

// Feature a hashtag on an actor's profile, matching Mastodon's
// CreateFeaturedTagService (find_or_initialize_by): re-featuring an
// already-featured tag returns the existing entry, and the per-account cap
// only applies when adding a NEW tag. Shared by POST /api/v1/featured_tags
// and POST /api/v1/tags/:tag/feature.
export const featureTag = async ({
  database,
  actorId,
  name
}: {
  database: Database
  actorId: string
  name: string
}): Promise<FeatureTagResult> => {
  const existing = await database.getFeaturedTagByName({ actorId, name })
  if (existing) return { status: 'featured', tag: existing }

  const featuredCount = await database.countFeaturedTags({ actorId })
  if (featuredCount >= FEATURED_TAGS_LIMIT) return { status: 'limit_reached' }

  const tag = await database.createFeaturedTag({ actorId, name })
  return { status: 'featured', tag }
}

// Unfeature a hashtag by name for POST /api/v1/tags/:tag/unfeature.
// Idempotent: unfeaturing a tag that is not featured is a no-op, matching
// Mastodon. (DELETE /api/v1/featured_tags/:id keeps its own by-id delete —
// its owner-scoped 404 semantics differ from this name-based no-op.)
export const unfeatureTag = async ({
  database,
  actorId,
  name
}: {
  database: Database
  actorId: string
  name: string
}): Promise<void> => {
  const existing = await database.getFeaturedTagByName({ actorId, name })
  if (!existing) return
  await database.deleteFeaturedTag({ actorId, id: existing.id })
}
