import {
  MEDIA_SUBJECT_CATEGORIES,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'

export const IUCN_CATEGORIES = [
  'CR',
  'EN',
  'VU',
  'NT',
  'LC',
  'DD',
  'NE',
  'EW',
  'EX'
] as const
export type IucnCategory = (typeof IUCN_CATEGORIES)[number]

export interface NormalizedTaxon {
  // The GBIF usage key, as a string. An accepted name's key: a synonym match
  // is reported under the key of the name it points to.
  taxonKey: string
  scientificName: string
  rank: string
  // [kingdom, phylum, class, order, family] names, those present.
  taxonPath: string[]
  category: MediaSubjectCategory
}

export interface NormalizedMatch extends NormalizedTaxon {
  // The match was a synonym; `taxonKey` is already the accepted key, but the
  // name and rank are the synonym's until the accepted taxon is read.
  synonym: boolean
}

export const MIN_MATCH_CONFIDENCE = 90

// GBIF ranks at or below species.
const SPECIES_OR_LOWER_RANKS = new Set([
  'SPECIES',
  'SUBSPECIES',
  'VARIETY',
  'FORM',
  'INFRASPECIFIC_NAME',
  'INFRASUBSPECIFIC_NAME',
  'ABERRATION',
  'CULTIVAR',
  'STRAIN',
  'FORMA_SPECIALIS'
])
const GROUP_RANKS = new Set(['GENUS', 'FAMILY'])

const CLASS_CATEGORY: Record<string, MediaSubjectCategory> = {
  aves: 'bird',
  mammalia: 'mammal',
  reptilia: 'reptile',
  amphibia: 'amphibian',
  actinopterygii: 'fish',
  chondrichthyes: 'fish',
  sarcopterygii: 'fish',
  myxini: 'fish',
  petromyzonti: 'fish',
  insecta: 'insect'
}

// Newer GBIF backbones file reptiles under their orders instead of a class.
const REPTILE_ORDERS = new Set(['squamata', 'testudines', 'crocodylia'])

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

// GBIF returns "Animalia" from the backbone and "ANIMALIA" from other
// checklists; show one spelling.
const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()

export const getTaxonCategory = (raw: Record<string, unknown>) => {
  const kingdom = asString(raw.kingdom)?.toLowerCase()
  if (kingdom === 'plantae') return 'plant'
  if (kingdom === 'fungi') return 'fungus'

  const taxonClass = asString(raw.class)?.toLowerCase()
  if (taxonClass && CLASS_CATEGORY[taxonClass])
    return CLASS_CATEGORY[taxonClass]
  const order = asString(raw.order)?.toLowerCase()
  if (order && REPTILE_ORDERS.has(order)) return 'reptile'
  return 'other'
}

export const getTaxonPath = (raw: Record<string, unknown>): string[] =>
  ['kingdom', 'phylum', 'class', 'order', 'family']
    .map((rank) => asString(raw[rank]))
    .filter((name): name is string => name !== null)
    .map((name) => titleCase(name).slice(0, 64))

const keyOf = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value === 'string' && /^\d{1,12}$/.test(value)) return value
  return null
}

/**
 * Accepts a `species/match` answer only when it is a real match: EXACT or
 * FUZZY, confidence of at least 90, and species or lower (or genus/family when
 * `allowHigherRank`, for a group pick). Null otherwise.
 */
export const normalizeMatch = (
  raw: unknown,
  { allowHigherRank = false }: { allowHigherRank?: boolean } = {}
): NormalizedMatch | null => {
  if (!raw || typeof raw !== 'object') return null
  const match = raw as Record<string, unknown>

  if (match.matchType !== 'EXACT' && match.matchType !== 'FUZZY') return null
  if (
    typeof match.confidence !== 'number' ||
    match.confidence < MIN_MATCH_CONFIDENCE
  ) {
    return null
  }

  const rank = asString(match.rank)?.toUpperCase()
  if (
    !rank ||
    !(
      SPECIES_OR_LOWER_RANKS.has(rank) ||
      (allowHigherRank && GROUP_RANKS.has(rank))
    )
  ) {
    return null
  }

  const acceptedKey = keyOf(match.acceptedUsageKey)
  const taxonKey = acceptedKey ?? keyOf(match.usageKey)
  const scientificName =
    asString(match.canonicalName) ?? asString(match.scientificName)
  if (!taxonKey || !scientificName) return null

  return {
    taxonKey,
    scientificName: scientificName.slice(0, 255),
    rank,
    taxonPath: getTaxonPath(match),
    category: getTaxonCategory(match),
    synonym: acceptedKey !== null && acceptedKey !== keyOf(match.usageKey)
  }
}

/**
 * Where GBIF placed a name it did not confidently match: a HIGHERRANK answer
 * ("Pongo abelii xyz" is placed in the species Pongo abelii), an EXACT or
 * FUZZY one below the confidence bar, or a match type this code does not
 * know. GBIF did classify these, so they are
 * not a miss for the place rule. The species is the answer's `speciesKey`, or
 * its own key when it is at species rank or lower; the genus likewise.
 */
export interface UncertainMatch {
  speciesKey: string | null
  genusKey: string | null
}

/**
 * The species or genus a `species/match` answer that `normalizeMatch`
 * rejected still names, or null when it names neither (`NONE`, or an answer
 * placed no lower than a family). Only call it for a readable answer that
 * `normalizeMatch` turned down.
 */
export const getUncertainMatch = (raw: unknown): UncertainMatch | null => {
  if (!raw || typeof raw !== 'object') return null
  const match = raw as Record<string, unknown>
  if (match.matchType === 'NONE') return null
  // A confident EXACT or FUZZY answer that was turned down for its rank names
  // a genus or family itself ("Pongo"): the owner named a group, which the
  // place rule clears as it clears a "Just genus" pick.
  const confident =
    (match.matchType === 'EXACT' || match.matchType === 'FUZZY') &&
    typeof match.confidence === 'number' &&
    match.confidence >= MIN_MATCH_CONFIDENCE
  if (confident) return null

  const rank = asString(match.rank)?.toUpperCase() ?? null
  const ownKey = keyOf(match.acceptedUsageKey) ?? keyOf(match.usageKey)
  const speciesKey =
    keyOf(match.speciesKey) ??
    (rank && SPECIES_OR_LOWER_RANKS.has(rank) ? ownKey : null)
  const genusKey = keyOf(match.genusKey) ?? (rank === 'GENUS' ? ownKey : null)
  if (!speciesKey && !genusKey) return null
  return { speciesKey, genusKey }
}

/**
 * Normalizes a `species/{key}` answer or a `species/search` result. These
 * carry no match confidence; the key is the backbone key when there is one.
 */
export const normalizeTaxonRecord = (raw: unknown): NormalizedTaxon | null => {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>

  const taxonKey = keyOf(record.nubKey) ?? keyOf(record.key)
  const scientificName =
    asString(record.canonicalName) ?? asString(record.scientificName)
  const rank = asString(record.rank)?.toUpperCase()
  if (!taxonKey || !scientificName || !rank) return null

  return {
    taxonKey,
    scientificName: scientificName.slice(0, 255),
    rank,
    taxonPath: getTaxonPath(record),
    category: getTaxonCategory(record)
  }
}

// The enum names GBIF spells the categories with in `category`.
const IUCN_CATEGORY_NAMES: Record<string, IucnCategory> = {
  EXTINCT: 'EX',
  EXTINCT_IN_THE_WILD: 'EW',
  CRITICALLY_ENDANGERED: 'CR',
  ENDANGERED: 'EN',
  VULNERABLE: 'VU',
  NEAR_THREATENED: 'NT',
  LEAST_CONCERN: 'LC',
  DATA_DEFICIENT: 'DD',
  NOT_EVALUATED: 'NE'
}

/**
 * GBIF's `iucnRedListCategory` answer: the two letter `code`, or failing that
 * the long `category` enum name (ENDANGERED is EN). Null when neither is one
 * this code knows. A caller must treat null for a 200 answer as UNREADABLE,
 * never as "not assessed": reading a changed shape as "not threatened" would
 * publish a threatened species' place.
 */
export const normalizeIucnCategory = (raw: unknown): IucnCategory | null => {
  if (!raw || typeof raw !== 'object') return null
  const code = asString((raw as { code?: unknown }).code)?.toUpperCase()
  if (code && (IUCN_CATEGORIES as readonly string[]).includes(code)) {
    return code as IucnCategory
  }
  const name = asString((raw as { category?: unknown }).category)
    ?.toUpperCase()
    .replace(/[\s-]+/g, '_')
  return (name && IUCN_CATEGORY_NAMES[name]) || null
}

/**
 * Whether a `species/match` answer is one this code can read at all: an
 * object with a `matchType`. `normalizeMatch` returning null for a readable
 * answer means "no confident match"; for an unreadable one it means GBIF
 * changed shape, which a caller records as a failure, not as a miss.
 */
export const isReadableMatch = (raw: unknown): boolean => {
  if (!raw || typeof raw !== 'object') return false
  const match = raw as Record<string, unknown>
  if (typeof match.matchType !== 'string') return false
  // An accepted match type must carry what normalizeMatch reads.
  if (match.matchType === 'EXACT' || match.matchType === 'FUZZY') {
    return (
      typeof match.confidence === 'number' &&
      asString(match.rank) !== null &&
      (keyOf(match.acceptedUsageKey) ?? keyOf(match.usageKey)) !== null &&
      (asString(match.canonicalName) ?? asString(match.scientificName)) !== null
    )
  }
  return true
}

export const isSubjectCategory = (
  value: unknown
): value is MediaSubjectCategory =>
  (MEDIA_SUBJECT_CATEGORIES as readonly unknown[]).includes(value)
