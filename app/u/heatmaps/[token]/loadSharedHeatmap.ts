import { cache } from 'react'

import { getBaseURL } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import {
  buildHeatmapTileSource,
  isPyramidVariantHeatmap
} from '@/lib/services/fitness-files/heatmapTiles/tileSource'
import {
  resolveSharedHeatmapRegionBounds,
  toPublicHeatmap
} from '@/lib/services/fitness-files/publicHeatmap'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { SharedHeatmapView, buildSharedHeatmapView } from './sharedHeatmapView'

export interface SharedHeatmapPageData {
  view: SharedHeatmapView
  /** Instance display name, for the card's `og:site_name`. */
  siteName: string
  /**
   * The actor's own canonical origin, which the card builds its image URL
   * against. Resolved here because deriving it needs the heatmap row.
   */
  origin: string
  /** Whether the page offers a sign-up call to action. */
  signupOpen: boolean
}

/**
 * Loads everything the public share page needs, or null when the token resolves
 * to nothing this surface may publish.
 *
 * Memoized per request with React `cache` because `generateMetadata` and the
 * page body both need the whole view: the card's title, handle and date are the
 * page's own heading and owner line, not a separate summary. Without it this
 * `force-dynamic` public route would run every read twice per request.
 */
export const loadSharedHeatmap = cache(
  async (token: string): Promise<SharedHeatmapPageData | null> => {
    const database = getDatabase()
    if (!database) return null

    const heatmap = await database.getFitnessRouteHeatmapByShareToken({
      shareToken: token
    })
    // Only publish a completed heatmap. A shared heatmap re-queued for
    // generation keeps its token but transitions back to pending/generating;
    // withhold it during that window rather than publish a partial/in-progress
    // page.
    if (!heatmap || heatmap.status !== 'completed') return null
    // See resolveSharedHeatmapRegionBounds: an unresolvable region means the
    // stored geometry was never clipped, so rendering it publishes the world.
    if (!resolveSharedHeatmapRegionBounds(heatmap)) return null

    // Flatten the privacy distinction so the public page shows no hole and no
    // highlight around private locations (see toPublicHeatmap).
    const publicHeatmap = toPublicHeatmap(heatmap)

    // Owner display fields (name/handle/initials). Non-critical chrome, so a
    // lookup failure degrades to an actor-id-derived handle rather than 404ing.
    const owner = await database
      .getActorFromId({ id: heatmap.actorId })
      .catch(() => null)

    // The owner-assigned region label (e.g. "Netherlands"), shown as the title
    // for drawn areas. Best-effort: a lookup failure degrades to the generic
    // label.
    let regionName: string | undefined
    try {
      const regionNames = await database.getFitnessRouteHeatmapRegionNames({
        actorId: heatmap.actorId
      })
      regionName = regionNames?.find(
        (entry) => entry.region === heatmap.region
      )?.name
    } catch {
      regionName = undefined
    }

    // Build the public URL against the actor's own canonical domain (matches the
    // in-app share snippet), falling back to the instance base URL.
    let origin: string
    try {
      origin = new URL(heatmap.actorId).origin
    } catch {
      origin = getBaseURL()
    }

    // Lets the page zoom into the pyramid through the embed tiles route. Read
    // only for the one row the pyramid can answer, and best-effort: the page's
    // untiled geometry renders either way, so a failure costs detail on zoom
    // rather than the whole map.
    const pyramid = isPyramidVariantHeatmap(heatmap)
      ? await database
          .getFitnessRouteHeatmapPyramid({ actorId: heatmap.actorId })
          .catch((error) => {
            logger.warn({
              message: 'Failed to read the route heatmap pyramid for a share',
              heatmapId: heatmap.id,
              actorId: heatmap.actorId,
              err: toLoggableError(error)
            })
            return null
          })
      : null

    const view = buildSharedHeatmapView({
      heatmap: publicHeatmap,
      tileSource: buildHeatmapTileSource(publicHeatmap, pyramid),
      owner: owner
        ? { name: owner.name, username: owner.username, domain: owner.domain }
        : null,
      regionName,
      origin,
      token
    })

    const { instance, registrations } =
      await getResolvedServerSettings(database)

    return {
      view,
      siteName: instance.name,
      origin,
      signupOpen: registrations.open
    }
  }
)
