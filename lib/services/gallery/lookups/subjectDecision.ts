import { isThreatenedIucnCategory } from '@/lib/services/gallery/threatenedSpecies'
import { IUCN_CATEGORIES, IucnCategory } from '@/lib/types/database/gallery'

import type { GbifTaxon } from './gbif'
import { GROUP_RANKS, SPECIES_OR_LOWER_RANKS } from './normalizeTaxon'

// The one place that decides what a subject lookup stores. It is fail-closed
// by construction: `decideSubjectLookup` writes a status that lets a place be
// shown (`no-match`, or `resolved` with a category outside CR, EN and VU) only
// for the four answers in the allow-list below, each checked field by field.
// Every other answer, including any shape or branch this file does not know,
// ends in the default: `failed`, which keeps the place withheld and offers the
// owner Retry.

/**
 * What the job learned from GBIF, the last answer that decides. The job
 * gathers it (`gatherSubjectEvidence`); a lookup that throws never reaches
 * here and is recorded as `failed`.
 */
export type SubjectEvidence = SubjectAnswer & {
  // The subject has a stored key GBIF answered it does not know, so the
  // answer came from its names. Such a subject was confirmed once: only a
  // taxon found by its names may replace the key, never a `no-match`.
  storedKeyUnknown: boolean
}

export type SubjectAnswer =
  // A `species/{key}` record: for the stored key, the key of a confident
  // match, or the key of a search result that names the subject exactly.
  // Null when GBIF answered that it does not know the key.
  | {
      kind: 'taxon'
      via: 'stored-key' | 'match' | 'search'
      taxon: GbifTaxon | null
    }
  // `species/match` answered NONE. `hinted`: the request carried a kingdom
  // hint, which can turn an exact name into NONE on its own.
  | { kind: 'match-none'; hinted: boolean }
  // `species/match` placed the name in a species or genus without a confident
  // match; `species` is that species' record, null when there is no species
  // key or GBIF does not know it.
  | {
      kind: 'match-uncertain'
      hinted: boolean
      speciesKey: string | null
      species: GbifTaxon | null
    }
  // `species/match` answered something else readable: a family, order or
  // kingdom, or a match type this code does not know.
  | { kind: 'match-unplaced'; hinted: boolean }
  // `species/search` named nothing exactly. `complete`: every result in the
  // answer could be read.
  | { kind: 'search-no-exact'; complete: boolean }
  // No name or key the job could ask about.
  | { kind: 'nothing-to-ask' }

export type SubjectLookupDecision =
  | {
      subjectLookupStatus: 'resolved'
      subjectTaxonKey?: string
      subjectTaxonPath: string[] | null
      subjectIucnCategory: IucnCategory
    }
  | {
      subjectLookupStatus: 'no-match'
      subjectTaxonPath: null
      subjectIucnCategory: null
    }
  | { subjectLookupStatus: 'failed' }

/*
 * The allow-list: the only answers that may make a place public. Anything else
 * is `failed` (or `resolved` with CR, EN or VU, which keeps the place withheld).
 *
 * 1. `resolved`, not threatened: a readable `species/{key}` record at species
 *    rank or lower (or a genus or family, a group the owner named), with a
 *    readable Red List category outside CR, EN and VU, or GBIF's 204 "not
 *    assessed" (stored as NE). Its key came from the stored key, a confident
 *    match or an exact search hit.
 * Answers 2 to 4 also need the subject to have no stored key GBIF has stopped
 * knowing: such a subject was confirmed once, and only a taxon replaces it.
 *
 * 2. `no-match`: `species/match` answered NONE, with no key of any kind, to a
 *    request that carried no kingdom hint. The job asks again without the hint
 *    whenever a hinted request is not a confident match.
 * 3. `no-match`: an unhinted `species/match` placed the name in a species
 *    (HIGHERRANK, or below the confidence bar), and that species' readable
 *    record has a readable LC, NT, DD or NE category (or GBIF's 204).
 * 4. `no-match`: a common-name `species/search` answered a readable list, every
 *    result readable, and none names the subject exactly.
 */

const FAILED: SubjectLookupDecision = { subjectLookupStatus: 'failed' }

// What an uncertain match may clear under: a species GBIF only guessed at
// clears its place only when the Red List does not count it as threatened.
// EX and EW (shown for a confident match) are not a guess worth clearing on.
const UNCERTAIN_CLEARING: ReadonlySet<IucnCategory> = new Set([
  'LC',
  'NT',
  'DD',
  'NE'
])

const isUsageKey = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,12}$/.test(value)

/**
 * A taxon record's Red List category as stored: the category, NE for GBIF's
 * 204 (null), or undefined for anything else (unreadable, so not cleared).
 */
const readCategory = (value: unknown): IucnCategory | undefined => {
  if (value === null) return 'NE'
  return typeof value === 'string' &&
    (IUCN_CATEGORIES as readonly string[]).includes(value)
    ? (value as IucnCategory)
    : undefined
}

const readTaxonPath = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((part) => typeof part === 'string')
    ? (value as string[])
    : undefined

/**
 * A taxon the decision can trust: a usage key, a rank in `ranks`, a path of
 * strings and a readable category. Undefined otherwise.
 */
const readTaxon = (
  taxon: unknown,
  ranks: (rank: string) => boolean
):
  | { taxonKey: string; taxonPath: string[]; category: IucnCategory }
  | undefined => {
  if (!taxon || typeof taxon !== 'object' || Array.isArray(taxon)) {
    return undefined
  }
  const record = taxon as Record<string, unknown>
  if (!isUsageKey(record.taxonKey)) return undefined
  if (typeof record.rank !== 'string' || !ranks(record.rank.toUpperCase())) {
    return undefined
  }
  const taxonPath = readTaxonPath(record.taxonPath)
  if (!taxonPath) return undefined
  // `iucnCategory` must be present: null is GBIF's 204, a missing field is not.
  if (!('iucnCategory' in record)) return undefined
  const category = readCategory(record.iucnCategory)
  if (!category) return undefined
  return { taxonKey: record.taxonKey, taxonPath, category }
}

const isTaxonRank = (rank: string) =>
  SPECIES_OR_LOWER_RANKS.has(rank) || GROUP_RANKS.has(rank)
const isSpeciesRank = (rank: string) => SPECIES_OR_LOWER_RANKS.has(rank)

const NO_MATCH: SubjectLookupDecision = {
  subjectLookupStatus: 'no-match',
  subjectTaxonPath: null,
  subjectIucnCategory: null
}

/**
 * What to store for a subject, from what GBIF answered. Takes `unknown` on
 * purpose: the evidence is checked here field by field, and anything that is
 * not exactly one of the allow-listed answers is `failed`.
 */
export const decideSubjectLookup = (
  evidence: unknown
): SubjectLookupDecision => {
  if (!evidence || typeof evidence !== 'object') return FAILED
  const answer = evidence as Record<string, unknown>
  if (answer.kind !== 'taxon' && answer.storedKeyUnknown !== false) {
    return FAILED
  }

  switch (answer.kind) {
    case 'taxon': {
      if (
        answer.via !== 'stored-key' &&
        answer.via !== 'match' &&
        answer.via !== 'search'
      ) {
        return FAILED
      }
      // A key GBIF does not know, even one it just named, is not "no such
      // species": the match and species services can disagree (a backbone
      // move), and a stored key may be retired. Hidden, with Retry.
      const taxon = readTaxon(answer.taxon, isTaxonRank)
      if (!taxon) return FAILED
      return {
        subjectLookupStatus: 'resolved',
        subjectTaxonKey: taxon.taxonKey,
        subjectTaxonPath: taxon.taxonPath,
        subjectIucnCategory: taxon.category
      }
    }

    case 'match-none':
      // A kingdom hint can turn an exact name into NONE on its own (a tiger
      // filed under plants), so only an unhinted NONE is GBIF not knowing it.
      return answer.hinted === false ? NO_MATCH : FAILED

    case 'match-uncertain': {
      if (answer.hinted !== false) return FAILED
      if (!isUsageKey(answer.speciesKey)) return FAILED
      // Placed in a species: that species' Red List category decides. The
      // owner's name was not confirmed, so no taxon key or path is written.
      const species = readTaxon(answer.species, isSpeciesRank)
      if (!species) return FAILED
      if (isThreatenedIucnCategory(species.category)) {
        return {
          subjectLookupStatus: 'resolved',
          subjectTaxonPath: null,
          subjectIucnCategory: species.category
        }
      }
      return UNCERTAIN_CLEARING.has(species.category) ? NO_MATCH : FAILED
    }

    case 'search-no-exact':
      // A result this code skipped may have been the name asked for.
      return answer.complete === true ? NO_MATCH : FAILED

    // `match-unplaced` (a family, an order or a kingdom: a wrong kingdom
    // hint gives a kingdom), `nothing-to-ask`, and anything else.
    default:
      return FAILED
  }
}
