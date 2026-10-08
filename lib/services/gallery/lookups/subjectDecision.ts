import { isThreatenedIucnCategory } from '@/lib/services/gallery/threatenedSpecies'
import { IUCN_CATEGORIES, IucnCategory } from '@/lib/types/database/gallery'

import type { GbifTaxon } from './gbif'
import {
  GROUP_RANKS,
  SPECIES_OR_LOWER_RANKS,
  isSameTaxonName
} from './normalizeTaxon'

// The one place that decides what a subject lookup stores. It is fail-closed
// by construction: `decideSubjectLookup` writes a status that lets a place be
// shown (`resolved` with a category outside CR, EN and VU) only for the
// answers in the allow-list below, each checked field by field. Every other
// answer, including any shape or branch this file does not know, ends in the
// default: `failed`, which keeps the place withheld and offers the owner
// Retry and the species picker. It never writes `no-match`: a name GBIF
// cannot place is not proof that the species is safe to show.

/**
 * What the job learned from GBIF, the last answer that decides. The job
 * gathers it (`gatherSubjectEvidence`); a lookup that throws never reaches
 * here and is recorded as `failed`.
 */
export type SubjectEvidence = SubjectAnswer & {
  // The subject has a stored key GBIF answered it does not know, so the
  // answer came from its names. Such a subject was confirmed once: only a
  // taxon found by its names may replace the key.
  storedKeyUnknown: boolean
}

export type SubjectAnswer =
  // The `species/{key}` record of the stored key. Null when GBIF answered
  // that it does not know the key. A key alone proves nothing about the
  // subject the owner named: an API client, a stale picker or a wrong
  // suggestion can send any species' key. So the record must agree with the
  // names the subject also has. `scientificName` and `name`: the subject's,
  // null when unset. `nameConfirmed`: one of the record's vernacular names is
  // `name` exactly (the record's own, or a search that lists the key as an
  // exact hit). `category`: the subject's category, null when unset.
  // `kingdom`: the kingdom that category names, null for one that names none.
  | {
      kind: 'taxon'
      via: 'stored-key'
      taxon: GbifTaxon | null
      scientificName: string | null
      name: string | null
      nameConfirmed: boolean
      category: string | null
      kingdom: string | null
    }
  // The `species/{key}` record of the key of a confident match. Null when
  // GBIF answered that it does not know the key.
  // `matchRank`: the rank the match named. A record counts as a species only
  // when the match named one too: a genus match is a group, whatever the
  // record says.
  | {
      kind: 'taxon'
      via: 'match'
      matchRank: string
      taxon: GbifTaxon | null
    }
  // A common-name `species/search`. `complete`: every result was readable.
  // `exhaustive`: GBIF said there are no more results. `exactHits`: how many
  // distinct results name the subject exactly, by scientific name or any of
  // their vernacular names. `kingdom`: the kingdom the subject's category
  // names, null for a category that names none. `taxon`: the `species/{key}`
  // record of the one exact hit, asked only when the search could confirm
  // it (complete, exhaustive, one hit), null otherwise or when GBIF does
  // not know the key.
  | {
      kind: 'search'
      complete: boolean
      exhaustive: boolean
      exactHits: number
      kingdom: string | null
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
  // No name or key the job could ask about.
  | { kind: 'nothing-to-ask' }

export type SubjectLookupDecision =
  | {
      subjectLookupStatus: 'resolved'
      subjectTaxonKey?: string
      subjectTaxonPath: string[] | null
      // Null for a genus or family: a group is never assessed on its own,
      // so it does not clear its place.
      subjectIucnCategory: IucnCategory | null
    }
  | { subjectLookupStatus: 'failed' }

/*
 * The allow-list: the only answers that may make a place public. A place is
 * shown only when the subject resolves to exactly one taxon at species rank
 * or lower, whose Red List category was read (GBIF's 204 "not assessed" is
 * NE) and is outside CR, EN and VU. Anything else is `failed`, or `resolved`
 * with CR, EN or VU, or `resolved` with no category for a group; each keeps
 * the place withheld.
 *
 * 1. A readable `species/{key}` record at species rank or lower for the
 *    stored key that agrees with the subject (see `storedKeyAgrees`), or
 *    for the key of a confident (EXACT or FUZZY, at least 90)
 *    `species/match` on the scientific name that named a species too. Its
 *    key, path and category are stored. A genus or family record (a "Just genus" pick, a typed "Pongo")
 *    is stored with its key and path and NO category: GBIF never assesses a
 *    genus, and its "NE" says nothing of its species (every Pongo is CR).
 * 2. A common-name `species/search` that is complete and exhaustive, with
 *    exactly one result naming the subject exactly across all its vernacular
 *    names, whose readable record is at species rank or lower and in the
 *    kingdom the subject's category names. Stored as in 1.
 * 3. An unhinted `species/match` that placed the name in a species without a
 *    confident match (HIGHERRANK, or below the confidence bar), whose readable
 *    species record has a readable LC, NT, DD or NE category (or GBIF's 204).
 *    Stored `resolved` with that category but no taxon key or path: the
 *    owner's name was not confirmed. CR, EN or VU is stored the same way and
 *    keeps the place hidden; EX, EW or a genus-only placement is `failed`.
 *    This answer never clears a subject whose stored key GBIF has stopped
 *    knowing: such a subject was confirmed once, and only a taxon found by
 *    its names replaces it.
 *
 * Everything else is `failed`: a stored key whose record disagrees with the
 * subject's names or category, GBIF's NONE, a search with no exact hit, more
 * than one, a page that is not the last or a result that could not be read,
 * a hit in another kingdom, an answer placed above a genus, and any shape
 * this file does not know.
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
  | {
      taxonKey: string
      rank: string
      taxonPath: string[]
      category: IucnCategory
    }
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
  return {
    taxonKey: record.taxonKey,
    rank: record.rank.toUpperCase(),
    taxonPath,
    category
  }
}

const readName = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null

/**
 * Whether a stored key's record is the subject the owner named. A subject
 * with a scientific name agrees only when the record's canonical or full
 * scientific name is that name; one with only a common name, only when one
 * of the record's vernacular names is that name exactly. A living category
 * must name the record's kingdom, and be the record's own category when GBIF
 * files it under one ("Vaquita" the mammal is also a beetle's common name,
 * in the same kingdom). A key-only subject (no names, no living category)
 * has nothing to disagree with.
 */
const storedKeyAgrees = (
  answer: Record<string, unknown>,
  record: Record<string, unknown>,
  taxonPath: string[]
): boolean => {
  if (answer.category !== null && typeof answer.category !== 'string') {
    return false
  }
  if (answer.kingdom !== null) {
    if (typeof answer.kingdom !== 'string' || !answer.kingdom) return false
    if (taxonPath[0] !== answer.kingdom) return false
    const recordCategory = record.category
    if (typeof recordCategory !== 'string') return false
    if (recordCategory !== 'other' && recordCategory !== answer.category) {
      return false
    }
  }
  if (answer.scientificName !== null) {
    const scientificName = readName(answer.scientificName)
    if (!scientificName) return false
    return [record.scientificName, record.fullScientificName].some(
      (value) =>
        typeof value === 'string' && isSameTaxonName(value, scientificName)
    )
  }
  if (answer.name !== null) {
    if (!readName(answer.name)) return false
    return answer.nameConfirmed === true
  }
  return true
}

const isTaxonRank = (rank: string) =>
  SPECIES_OR_LOWER_RANKS.has(rank) || GROUP_RANKS.has(rank)
const isSpeciesRank = (rank: string) => SPECIES_OR_LOWER_RANKS.has(rank)

/**
 * A taxon as stored: a species keeps its category, a genus or family (or a
 * record `asSpecies` says is not confirmed as a species) is stored with
 * none, so its place stays hidden.
 */
const resolvedTaxon = (
  taxon: {
    taxonKey: string
    taxonPath: string[]
    category: IucnCategory
    rank: string
  },
  asSpecies = true
): SubjectLookupDecision => ({
  subjectLookupStatus: 'resolved',
  subjectTaxonKey: taxon.taxonKey,
  subjectTaxonPath: taxon.taxonPath,
  subjectIucnCategory:
    asSpecies && isSpeciesRank(taxon.rank) ? taxon.category : null
})

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
  if (typeof answer.storedKeyUnknown !== 'boolean') return FAILED

  switch (answer.kind) {
    case 'taxon': {
      if (answer.via !== 'stored-key' && answer.via !== 'match') {
        return FAILED
      }
      // A key GBIF does not know, even one it just named, is not "no such
      // species": the match and species services can disagree (a backbone
      // move), and a stored key may be retired. Hidden, with Retry.
      const taxon = readTaxon(answer.taxon, isTaxonRank)
      if (!taxon) return FAILED
      if (answer.via === 'stored-key') {
        // "Panda" (a mammal) stored with the key of the tree Panda oleosa
        // must not clear as that tree.
        if (
          !storedKeyAgrees(
            answer,
            answer.taxon as Record<string, unknown>,
            taxon.taxonPath
          )
        ) {
          return FAILED
        }
      }
      if (answer.via === 'match') {
        if (typeof answer.matchRank !== 'string') return FAILED
        const matchRank = answer.matchRank.toUpperCase()
        if (!isTaxonRank(matchRank)) return FAILED
        if (!isSpeciesRank(matchRank)) return resolvedTaxon(taxon, false)
      }
      return resolvedTaxon(taxon)
    }

    case 'search': {
      // A ranked full-text page proves nothing unless it is the whole answer,
      // every result in it was read, and exactly one names the subject.
      if (answer.complete !== true || answer.exhaustive !== true) return FAILED
      if (answer.exactHits !== 1) return FAILED
      if (typeof answer.kingdom !== 'string' || !answer.kingdom) return FAILED
      const taxon = readTaxon(answer.taxon, isSpeciesRank)
      if (!taxon) return FAILED
      // "Panda" filed as a mammal must not clear as the tree Panda oleosa.
      if (taxon.taxonPath[0] !== answer.kingdom) return FAILED
      return resolvedTaxon(taxon)
    }

    case 'match-uncertain': {
      // A subject confirmed by a key once is replaced only by a taxon found
      // by its names, never by a guess.
      if (answer.storedKeyUnknown !== false) return FAILED
      if (answer.hinted !== false) return FAILED
      if (!isUsageKey(answer.speciesKey)) return FAILED
      // Placed in a species: that species' Red List category decides. The
      // owner's name was not confirmed, so no taxon key or path is written.
      const species = readTaxon(answer.species, isSpeciesRank)
      if (!species) return FAILED
      if (
        !isThreatenedIucnCategory(species.category) &&
        !UNCERTAIN_CLEARING.has(species.category)
      ) {
        return FAILED
      }
      return {
        subjectLookupStatus: 'resolved',
        subjectTaxonPath: null,
        subjectIucnCategory: species.category
      }
    }

    // `match-none` (GBIF's NONE: a typo, or a species GBIF files under
    // another name, cannot be told apart), `match-unplaced` (a family, an
    // order or a kingdom: a wrong kingdom hint gives a kingdom),
    // `nothing-to-ask`, and anything else.
    default:
      return FAILED
  }
}
