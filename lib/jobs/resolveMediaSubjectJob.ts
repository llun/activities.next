import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { RESOLVE_MEDIA_SUBJECT_JOB_NAME } from '@/lib/jobs/names'
import {
  GbifClient,
  createGbifClient
} from '@/lib/services/gallery/lookups/gbif'
import {
  SubjectAnswer,
  SubjectEvidence,
  decideSubjectLookup
} from '@/lib/services/gallery/lookups/subjectDecision'
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

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() ===
  b.trim().replace(/\s+/g, ' ').toLowerCase()

type SubjectFields = Pick<
  MediaDetailsRecord,
  | 'subjectName'
  | 'subjectScientificName'
  | 'subjectCategory'
  | 'subjectTaxonKey'
>

/**
 * Asks GBIF about a subject and returns the last answer that decides it, for
 * `decideSubjectLookup`. It only gathers: it never chooses a status, so no
 * branch here can clear a place by itself. A lookup failure throws.
 *
 * - A stored key first. A key GBIF does not know falls through to the names
 *   (a backbone move can retire one), and the evidence says so; with no name
 *   left the unknown key is the evidence.
 * - A scientific name through `species/match`, with the category's kingdom
 *   hint. Any hinted answer but a confident match is asked again without the
 *   hint: a wrong category ("Panthera tigris" filed as a plant) makes GBIF
 *   answer a kingdom, or NONE, for a name it matches exactly.
 * - Only a common name: a search result that names it exactly. A near miss is
 *   not a match; the owner can pick from the search.
 */
export const gatherSubjectEvidence = async (
  gbif: GbifClient,
  subject: SubjectFields
): Promise<SubjectEvidence> => {
  const taxonKey = subject.subjectTaxonKey?.trim() || null
  const scientificName = subject.subjectScientificName?.trim() || null
  const commonName = subject.subjectName?.trim() || null

  let storedKeyUnknown = false
  if (taxonKey) {
    const taxon = await gbif.getTaxon(taxonKey)
    if (taxon || (!scientificName && !commonName)) {
      return { kind: 'taxon', via: 'stored-key', taxon, storedKeyUnknown }
    }
    storedKeyUnknown = true
  }
  const answer = await askByName(gbif, subject, scientificName, commonName)
  return { ...answer, storedKeyUnknown }
}

const askByName = async (
  gbif: GbifClient,
  subject: SubjectFields,
  scientificName: string | null,
  commonName: string | null
): Promise<SubjectAnswer> => {
  if (scientificName) {
    const kingdom = subject.subjectCategory
      ? KINGDOM_HINTS[subject.subjectCategory]
      : undefined
    // A typed genus or family ("Pongo") is a group, as a "Just genus" pick is.
    let outcome = await gbif.lookupMatch(scientificName, {
      kingdom,
      allowHigherRank: true
    })
    let hinted = Boolean(kingdom)
    if (hinted && outcome?.kind !== 'match') {
      outcome = await gbif.lookupMatch(scientificName, {
        allowHigherRank: true
      })
      hinted = false
    }
    switch (outcome?.kind) {
      case 'match':
        return {
          kind: 'taxon',
          via: 'match',
          taxon: await gbif.getTaxon(outcome.taxon.taxonKey)
        }
      case 'none':
        return { kind: 'match-none', hinted }
      case 'uncertain': {
        const { speciesKey } = outcome.uncertain
        return {
          kind: 'match-uncertain',
          hinted,
          speciesKey,
          species: speciesKey ? await gbif.getTaxon(speciesKey) : null
        }
      }
      default:
        return { kind: 'match-unplaced', hinted }
    }
  }

  if (commonName) {
    const search = await gbif.lookupSearch(commonName)
    if (!search) return { kind: 'nothing-to-ask' }
    const exact = search.results.find(
      (result) =>
        sameName(result.scientificName, commonName) ||
        result.vernacularNames.some((name) => sameName(name, commonName))
    )
    if (!exact) return { kind: 'search-no-exact', complete: search.complete }
    return {
      kind: 'taxon',
      via: 'search',
      taxon: await gbif.getTaxon(exact.taxonKey)
    }
  }

  return { kind: 'nothing-to-ask' }
}

/**
 * Resolve a species-like subject against GBIF (taxon, path) and the IUCN Red
 * List category GBIF carries, and store the result for the place rule.
 *
 * Everything is read again here, not taken from the message: the owner may
 * have edited the subject since this was queued. The write is a compare-and-set
 * on the subject fields that were read, the category included, so an edit
 * made meanwhile wins and the edit's own job resolves the new subject.
 *
 * What is stored is decided only by `decideSubjectLookup`, which lets a
 * place be shown for an allow-list of verified answers and records `failed`
 * for everything else. Provider errors are caught the same way: the job
 * records `failed` (persisted, so the owner sees it and can retry) and returns
 * normally, so a rate-limited free service is not retried into the ground.
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

    // The category is compared too: it is the kingdom hint, so a result
    // worked out under the old category is not the new one's.
    const expect = {
      subjectName: details.subjectName ?? null,
      subjectScientificName: details.subjectScientificName ?? null,
      subjectTaxonKey: details.subjectTaxonKey ?? null,
      subjectCategory: details.subjectCategory ?? null
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
      const evidence = await gatherSubjectEvidence(gbif, details)
      const decision = decideSubjectLookup(evidence)
      if (decision.subjectLookupStatus === 'failed') {
        logger.info({
          message: 'Subject lookup not verified; its place stays hidden',
          mediaId,
          evidence: evidence.kind
        })
      }
      await write(decision)
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
