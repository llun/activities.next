import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { RESOLVE_MEDIA_SUBJECT_JOB_NAME } from '@/lib/jobs/names'
import { createGbifClient } from '@/lib/services/gallery/lookups/gbif'
import { isSpeciesLike } from '@/lib/services/gallery/publicMediaDetails'
import { JobHandle } from '@/lib/services/queue/type'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

const ResolveMediaSubjectJobData = z.object({
  mediaId: z.string().min(1)
})

const KINGDOM_HINTS: Record<string, string> = {
  plant: 'Plantae',
  fungus: 'Fungi',
  bird: 'Animalia',
  mammal: 'Animalia',
  reptile: 'Animalia',
  amphibian: 'Animalia',
  fish: 'Animalia',
  insect: 'Animalia'
}

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() ===
  b.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Resolve a species-like subject against GBIF (taxon, path) and the IUCN Red
 * List category GBIF carries, and store the result for the place rule.
 *
 * Everything is read again here, not taken from the message: the owner may
 * have edited the subject since this was queued. The write is a compare-and-set
 * on the subject fields that were read, so an edit made meanwhile wins and the
 * edit's own job resolves the new subject.
 *
 * Provider errors are caught: the job records `failed` (persisted, so the
 * owner sees it and can retry) and returns normally, so a rate-limited free
 * service is not retried into the ground.
 */
export const resolveMediaSubjectJob: JobHandle = createJobHandle(
  RESOLVE_MEDIA_SUBJECT_JOB_NAME,
  async (database, message) => {
    const parsed = ResolveMediaSubjectJobData.safeParse(message.data)
    if (!parsed.success) return

    const { mediaId } = parsed.data
    const found = await database.getMediaWithAttachedStatusIds({ mediaId })
    const details: MediaDetailsRecord | undefined = found?.media.details
    if (!details) return

    const expect = {
      subjectName: details.subjectName ?? null,
      subjectScientificName: details.subjectScientificName ?? null,
      subjectTaxonKey: details.subjectTaxonKey ?? null
    }
    const write = async (
      patch: Parameters<typeof database.setMediaSubjectLookup>[0]['patch']
    ) => {
      const applied = await database.setMediaSubjectLookup({
        mediaId,
        expect,
        patch
      })
      if (!applied) {
        logger.debug({
          message: 'Subject lookup result dropped: the subject changed',
          mediaId
        })
      }
    }

    // Nothing to look up for a landscape or an unnamed subject. Re-checked
    // here, the way the place rule will read it.
    if (!isSpeciesLike(details)) {
      if ((details.subjectLookupStatus ?? null) !== null) {
        await write({ subjectLookupStatus: null })
      }
      return
    }

    // Re-checked at run time: a job can sit in the queue far longer than an
    // operator wants outbound requests to keep flowing after the switch is off.
    const { network } = await getResolvedServerSettings(database)
    if (!network.speciesLookups) {
      // A result already stored for this exact subject (an edit resets the
      // status to pending) stays valid; only an unchecked one is marked.
      const status = details.subjectLookupStatus ?? null
      if (status !== 'resolved' && status !== 'no-match') {
        await write({ subjectLookupStatus: 'disabled' })
      }
      return
    }

    try {
      const gbif = createGbifClient({ database })

      let taxonKey = expect.subjectTaxonKey
      if (!taxonKey && expect.subjectScientificName) {
        const match = await gbif.matchTaxon(expect.subjectScientificName, {
          kingdom: details.subjectCategory
            ? KINGDOM_HINTS[details.subjectCategory]
            : undefined
        })
        taxonKey = match?.taxonKey ?? null
      }
      if (!taxonKey && !expect.subjectScientificName && expect.subjectName) {
        // Only a common name: take a search result that names it exactly.
        // A near miss is not a match; the owner can pick from the search.
        const subjectName = expect.subjectName
        const results = await gbif.searchTaxa(subjectName)
        const exact = results.find(
          (result) =>
            sameName(result.scientificName, subjectName) ||
            result.vernacularNames.some((name) => sameName(name, subjectName))
        )
        taxonKey = exact?.taxonKey ?? null
      }

      const taxon = taxonKey ? await gbif.getTaxon(taxonKey) : null
      if (!taxon) {
        await write({
          subjectIucnCategory: null,
          subjectTaxonPath: null,
          subjectLookupStatus: 'no-match'
        })
        return
      }

      await write({
        subjectTaxonKey: taxon.taxonKey,
        subjectTaxonPath: taxon.taxonPath,
        // No assessment is written as NE (not evaluated): a resolved subject with
        // no category keeps its place hidden, because the privacy rule fails closed.
        subjectIucnCategory: taxon.iucnCategory ?? 'NE',
        subjectLookupStatus: 'resolved'
      })
    } catch (error) {
      logger.warn({
        message: 'Failed to resolve the subject of a media',
        mediaId,
        err: toLoggableError(error)
      })
      try {
        await write({ subjectLookupStatus: 'failed' })
      } catch (writeError) {
        logger.warn({
          message: 'Failed to record the failed subject lookup',
          mediaId,
          err: toLoggableError(writeError)
        })
      }
    }
  }
)
