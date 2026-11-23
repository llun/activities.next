import { getKysely } from '@/lib/database'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { EMBED_SEARCH_DOCUMENTS_JOB_NAME } from '@/lib/jobs/names'
import { JobHandle } from '@/lib/services/queue/type'
import { runEmbeddingJob } from '@/lib/services/search/semantic/semanticSearch'

/**
 * Embeds a batch of the search documents marked pending by recent writes (see
 * lib/services/search/semantic/semanticSearch.ts). A no-op unless semantic
 * search is configured and set up on this database.
 */
export const embedSearchDocumentsJob: JobHandle = createJobHandle(
  EMBED_SEARCH_DOCUMENTS_JOB_NAME,
  async () => {
    await runEmbeddingJob(getKysely())
  }
)
