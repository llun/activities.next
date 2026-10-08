import { z } from 'zod'

import { createJobHandle } from '@/lib/jobs/createJobHandle'
import { RESOLVE_MEDIA_SUBJECT_JOB_NAME } from '@/lib/jobs/names'
import {
  GbifClient,
  createGbifClient
} from '@/lib/services/gallery/lookups/gbif'
import {
  isSameTaxonName,
  kingdomOfCategory
} from '@/lib/services/gallery/lookups/normalizeTaxon'
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
 * - A stored key first. Its record is evidence only together with the names
 *   the subject also has, which the decision checks it against: any key can
 *   reach here (an API client's `subject_taxon_key`, a stale picker). For a
 *   subject named only by a common name, the record's own vernacular name
 *   is read first, then a search for the name, which lists every vernacular
 *   name of each result. A key GBIF does not know falls through to the
 *   names (a backbone move can retire one), and the evidence says so; with
 *   no name left the unknown key is the evidence.
 * - A scientific name through `species/match`, with the category's kingdom
 *   hint. Any hinted answer but a confident match is asked again without the
 *   hint: a wrong category ("Panthera tigris" filed as a plant) makes GBIF
 *   answer a kingdom, or NONE, for a name it matches exactly.
 * - Only a common name: the search, with how many results name it exactly
 *   and the kingdom its category names. The record of the one exact hit is
 *   read only when the search could confirm it (every result readable, no
 *   more pages, exactly one hit); the decision checks the rest. A near miss
 *   is not a match; the owner can pick from the search.
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
      return {
        kind: 'taxon',
        via: 'stored-key',
        taxon,
        scientificName,
        name: commonName,
        nameConfirmed: taxon
          ? await isNameOfTaxon(gbif, taxon, scientificName, commonName)
          : false,
        category: subject.subjectCategory ?? null,
        kingdom: kingdomOfCategory(subject.subjectCategory),
        storedKeyUnknown
      }
    }
    storedKeyUnknown = true
  }
  const answer = await askByName(gbif, subject, scientificName, commonName)
  return { ...answer, storedKeyUnknown }
}

/**
 * Whether `name` is one of the vernacular names of the stored key's record.
 * Asked only for a subject with no scientific name (the scientific name
 * decides otherwise). The search is not asked to be exhaustive: it only has
 * to list this key as a result that names `name` exactly.
 */
const isNameOfTaxon = async (
  gbif: GbifClient,
  taxon: { taxonKey: string; vernacularName: string | null },
  scientificName: string | null,
  name: string | null
): Promise<boolean> => {
  if (scientificName || !name) return false
  if (taxon.vernacularName && isSameTaxonName(taxon.vernacularName, name)) {
    return true
  }
  const search = await gbif.lookupSearch(name)
  return Boolean(search?.exactTaxonKeys.includes(taxon.taxonKey))
}

const askByName = async (
  gbif: GbifClient,
  subject: SubjectFields,
  scientificName: string | null,
  commonName: string | null
): Promise<SubjectAnswer> => {
  if (scientificName) {
    const kingdom = kingdomOfCategory(subject.subjectCategory) ?? undefined
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
          matchRank: outcome.taxon.rank,
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
    const { complete, exhaustive, exactTaxonKeys } = search
    const confirmable = complete && exhaustive && exactTaxonKeys.length === 1
    return {
      kind: 'search',
      complete,
      exhaustive,
      exactHits: exactTaxonKeys.length,
      kingdom: kingdomOfCategory(subject.subjectCategory),
      taxon: confirmable ? await gbif.getTaxon(exactTaxonKeys[0]) : null
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
 * place be shown only for a subject confirmed as one species that is not
 * threatened, and records `failed` (or `resolved` with no category, for a
 * genus or family) for everything else. Provider errors are caught the same way: the job
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
