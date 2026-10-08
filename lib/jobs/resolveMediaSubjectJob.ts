import { z } from 'zod'

import { Database } from '@/lib/database/types'
import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { RESOLVE_MEDIA_SUBJECT_JOB_NAME } from '@/lib/jobs/names'
import {
  GbifClient,
  GbifTaxon,
  createGbifClient
} from '@/lib/services/gallery/lookups/gbif'
import { LookupError } from '@/lib/services/gallery/lookups/lookupRequest'
import {
  IucnCategory,
  UncertainMatch
} from '@/lib/services/gallery/lookups/normalizeTaxon'
import { isSpeciesLike } from '@/lib/services/gallery/publicMediaDetails'
import { JobHandle } from '@/lib/services/queue/type'
import { getResolvedServerSettings } from '@/lib/services/serverSettings'
import { MediaDetailsRecord } from '@/lib/types/database/gallery'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

const ResolveMediaSubjectJobData = z.object({
  mediaId: z.string().min(1),
  // The owner's Retry: remembered provider failures are asked again.
  retry: z.boolean().optional()
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

// The categories under which an uncertain match may clear the place: GBIF's
// best guess is a species the Red List does not count as threatened (or that
// it has not assessed, which a confident match also clears).
const CLEARING_CATEGORIES: ReadonlySet<IucnCategory> = new Set([
  'LC',
  'NT',
  'DD',
  'NE'
])
const THREATENED_CATEGORIES: ReadonlySet<IucnCategory> = new Set([
  'CR',
  'EN',
  'VU'
])

type SubjectLookupPatch = Parameters<
  Database['setMediaSubjectLookup']
>[0]['patch']

/**
 * The result for a name GBIF placed in a species or genus without a confident
 * match (HIGHERRANK, or below the confidence bar). It is never `no-match` by
 * itself: GBIF did classify the name, and "Pongo abelii xyz" is placed in the
 * Sumatran orangutan, which is CR.
 *
 * - Placed in a species: that species' IUCN category decides. LC, NT, DD or
 *   NE (or no assessment) is `no-match`, which clears the place as a name GBIF
 *   cannot classify would, and leaves the owner's subject unconfirmed. CR, EN
 *   or VU is `resolved` with that category but no taxon key (the owner's name
 *   was not confirmed), so the place stays hidden and the owner is told why.
 *   EX or EW is `failed`: a confident match would show that place, but GBIF's
 *   guess is not a confident match, so it stays hidden.
 * - Placed only in a genus: which species it is cannot be told, and a genus
 *   has no Red List category of its own, so it is `failed` (hidden, with
 *   Retry) until the owner corrects or confirms the name.
 * A lookup failure while checking the species throws, which records `failed`.
 */
const resolveUncertainMatch = async (
  gbif: GbifClient,
  uncertain: UncertainMatch,
  mediaId: string
): Promise<SubjectLookupPatch> => {
  if (!uncertain.speciesKey) {
    logger.info({
      message: 'Subject only placed in a genus; its place stays hidden',
      mediaId
    })
    return { subjectLookupStatus: 'failed' }
  }
  const species = await gbif.getTaxon(uncertain.speciesKey)
  if (!species) {
    throw new LookupError('parse', 'GBIF does not know the species it named')
  }
  const category = species.iucnCategory ?? 'NE'
  if (CLEARING_CATEGORIES.has(category)) {
    return {
      subjectIucnCategory: null,
      subjectTaxonPath: null,
      subjectLookupStatus: 'no-match'
    }
  }
  if (THREATENED_CATEGORIES.has(category)) {
    return {
      subjectIucnCategory: category,
      subjectTaxonPath: null,
      subjectLookupStatus: 'resolved'
    }
  }
  return { subjectLookupStatus: 'failed' }
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

    const { mediaId, retry = false } = parsed.data
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
      const gbif = createGbifClient({ database, skipCachedErrors: retry })

      // A stored key first. GBIF answers a key it does not know (a backbone
      // move can retire one) with its own 404, and then the names are tried,
      // so a retired key never reads as "no such species" on its own.
      let taxon: GbifTaxon | null = expect.subjectTaxonKey
        ? await gbif.getTaxon(expect.subjectTaxonKey)
        : null
      let uncertain: UncertainMatch | null = null
      if (!taxon && expect.subjectScientificName) {
        const outcome = await gbif.lookupMatch(expect.subjectScientificName, {
          kingdom: details.subjectCategory
            ? KINGDOM_HINTS[details.subjectCategory]
            : undefined
        })
        if (outcome?.kind === 'match') {
          taxon = await gbif.getTaxon(outcome.taxon.taxonKey)
        } else if (outcome?.kind === 'uncertain') {
          uncertain = outcome.uncertain
        }
      } else if (!taxon && expect.subjectName) {
        // Only a common name: take a search result that names it exactly.
        // A near miss is not a match; the owner can pick from the search.
        const subjectName = expect.subjectName
        const results = await gbif.searchTaxa(subjectName)
        const exact = results.find(
          (result) =>
            sameName(result.scientificName, subjectName) ||
            result.vernacularNames.some((name) => sameName(name, subjectName))
        )
        taxon = exact ? await gbif.getTaxon(exact.taxonKey) : null
      }

      if (!taxon && uncertain) {
        await write(await resolveUncertainMatch(gbif, uncertain, mediaId))
        return
      }

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
        // Null here only means GBIF answered that it has no assessment (204),
        // which is NE (not evaluated) and clears the place. An answer the
        // client could not read threw instead and is recorded as `failed`
        // below, so the place stays hidden. A resolved row with no category
        // at all is treated as unchecked by the privacy rule.
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
