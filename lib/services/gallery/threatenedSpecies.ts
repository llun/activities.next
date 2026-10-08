import type {
  IucnCategory,
  MediaDetailsRecord,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'

// The threatened-species rule, pure and free of server-only imports so the
// database layer (which resets lookup state on a subject edit) and the public
// projection decide "species-like" the same way.

/** IUCN Red List categories that withhold a place: CR, EN and VU. */
export const THREATENED_IUCN = [
  'CR',
  'EN',
  'VU'
] as const satisfies readonly IucnCategory[]

// Categories of living things a common name alone can name a species in.
// `landscape` and `other` are not.
export const LIVING_SUBJECT_CATEGORIES: ReadonlySet<MediaSubjectCategory> =
  new Set<MediaSubjectCategory>([
    'bird',
    'mammal',
    'reptile',
    'amphibian',
    'fish',
    'insect',
    'plant',
    'fungus'
  ])

export type SpeciesLikeInput = Pick<
  MediaDetailsRecord,
  | 'subjectName'
  | 'subjectScientificName'
  | 'subjectCategory'
  | 'subjectTaxonKey'
>

export type ThreatInput = SpeciesLikeInput &
  Pick<MediaDetailsRecord, 'subjectIucnCategory' | 'subjectLookupStatus'>

/**
 * Whether the subject could be a species: it has a GBIF key, a scientific
 * name, or a common name in a living category.
 */
export const isSpeciesLike = (details: SpeciesLikeInput): boolean =>
  Boolean(
    details.subjectTaxonKey?.trim() ||
    details.subjectScientificName?.trim() ||
    (details.subjectName?.trim() &&
      details.subjectCategory &&
      LIVING_SUBJECT_CATEGORIES.has(details.subjectCategory))
  )

export const isThreatenedIucnCategory = (
  category: IucnCategory | null
): boolean =>
  category !== null &&
  (THREATENED_IUCN as readonly IucnCategory[]).includes(category)

/**
 * Whether a lookup positively cleared the subject: GBIF could not match the
 * name at all (`no-match`, shown: a typo cannot be classified), or it resolved
 * to a taxon with a known IUCN category outside CR, EN and VU.
 *
 * `resolved` with no category is NOT cleared. The subject job always writes a
 * category for a resolved taxon (`NE` when GBIF has no assessment), so a
 * missing one means something went wrong, and the rule fails closed.
 */
const isClearedByLookup = (details: ThreatInput): boolean =>
  details.subjectLookupStatus === 'no-match' ||
  (details.subjectLookupStatus === 'resolved' &&
    details.subjectIucnCategory !== null &&
    !isThreatenedIucnCategory(details.subjectIucnCategory))

/**
 * The fail-closed rule: with `hideThreatenedPlaces` on, a species-like
 * subject's place is withheld from everyone but the owner until a lookup
 * clears it. A null, pending, failed or disabled lookup keeps it withheld.
 */
export const isPlaceWithheldForThreat = (
  details: ThreatInput,
  { hideThreatenedPlaces }: { hideThreatenedPlaces: boolean }
): boolean =>
  hideThreatenedPlaces !== false &&
  isSpeciesLike(details) &&
  !isClearedByLookup(details)

export type SubjectThreatStatus = 'threatened' | 'not-threatened' | 'unchecked'

/**
 * The owner-facing summary of the lookup. A subject that is not species-like
 * has nothing to check, so it reads as `not-threatened`.
 */
export const getSubjectThreatStatus = (
  details: ThreatInput
): SubjectThreatStatus => {
  if (!isSpeciesLike(details)) return 'not-threatened'
  if (
    details.subjectLookupStatus === 'resolved' &&
    isThreatenedIucnCategory(details.subjectIucnCategory)
  ) {
    return 'threatened'
  }
  return isClearedByLookup(details) ? 'not-threatened' : 'unchecked'
}
