import { setSemanticSearchListener } from '@/lib/database/domains/search/semanticHooks'
import { getSemanticAvailability } from '@/lib/database/domains/search/semanticStore'
import type { Db } from '@/lib/database/kysely'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { getEmbeddingProvider } from './index'
import { createSemanticSearchListener } from './semanticSearch'

// Wires the write hook when an embeddings provider is configured and logs, once,
// whether semantic search is on here. Without a provider nothing is logged: the
// layer is simply not in use. The hook stays wired while the database lacks the
// tables, so a later `yarn search:semantic:setup` is picked up without a
// restart (availability is re-read every few minutes).
export const startSemanticSearch = async (getDb: () => Db): Promise<void> => {
  const provider = getEmbeddingProvider()
  if (!provider) return
  setSemanticSearchListener(createSemanticSearchListener(getDb))
  try {
    const availability = await getSemanticAvailability(
      getDb(),
      provider.dimensions
    )
    logger.info({
      message: availability.available
        ? `Semantic search is on (${provider.model}, ${provider.dimensions} dimensions)`
        : `Semantic search is off: ${availability.reason}`
    })
  } catch (error) {
    logger.info({
      message: 'Semantic search is off: the availability check failed',
      err: toLoggableError(error)
    })
  }
}
