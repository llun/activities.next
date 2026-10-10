import type { UpdateMediaDetailsFields } from '@/lib/client'
import type { MediaDetailsEntity } from '@/lib/services/medias/types'
import type {
  MediaPlacePrecision,
  MediaSubjectCategory
} from '@/lib/types/database/gallery'

/** What the dialog edits for one item. Strings are never null: '' means unset. */
export interface MediaDetailsDraft {
  description: string
  /** Client-only: the author chose to post this item without a description. */
  decorative: boolean
  inGallery: boolean
  subjectName: string
  subjectScientificName: string
  subjectCategory: MediaSubjectCategory | ''
  /** A GBIF usage key (digits), '' when the subject is not a matched taxon. */
  subjectTaxonKey: string
  /** Display only, never sent: the matched taxon's kingdom-to-family names. */
  subjectTaxonPath: string[]
  cameraGearId: string
  lensGearId: string
  placeName: string
  placePrecision: MediaPlacePrecision | ''
}

export const draftFromDetails = (
  description: string,
  decorative: boolean,
  details: MediaDetailsEntity | null | undefined
): MediaDetailsDraft => ({
  description,
  decorative,
  inGallery: details?.inGallery ?? false,
  subjectName: details?.subject?.name ?? '',
  subjectScientificName: details?.subject?.scientificName ?? '',
  subjectCategory: details?.subject?.category ?? '',
  subjectTaxonKey: details?.subject?.taxonKey ?? '',
  subjectTaxonPath: details?.subject?.taxonPath ?? [],
  cameraGearId: details?.camera?.id ?? '',
  lensGearId: details?.lens?.id ?? '',
  placeName: details?.place?.name ?? '',
  placePrecision: details?.place?.precision ?? ''
})

export type SharedSections = {
  gallery: boolean
  gear: boolean
  place: boolean
  /** Add to gallery's Apply to all; the other dialogs share it per picker. */
  subject?: boolean
}

/**
 * Copies the "use for all items" sections of `source` onto `target`, so a
 * checked box carries the visible item's choice to every other item.
 */
export const applySharedSections = (
  target: MediaDetailsDraft,
  source: MediaDetailsDraft,
  shared: SharedSections
): MediaDetailsDraft => ({
  ...target,
  ...(shared.gallery ? { inGallery: source.inGallery } : {}),
  ...(shared.gear
    ? { cameraGearId: source.cameraGearId, lensGearId: source.lensGearId }
    : {}),
  ...(shared.place
    ? { placeName: source.placeName, placePrecision: source.placePrecision }
    : {}),
  ...(shared.subject
    ? {
        subjectName: source.subjectName,
        subjectScientificName: source.subjectScientificName,
        subjectCategory: source.subjectCategory,
        subjectTaxonKey: source.subjectTaxonKey,
        subjectTaxonPath: source.subjectTaxonPath
      }
    : {})
})

/** A subject the author chose from the suggestions or the species picker. */
export interface PickedSubject {
  name: string
  scientificName: string
  category: MediaSubjectCategory | ''
  taxonKey: string
  taxonPath: string[]
}

export const SUBJECT_DRAFT_KEYS = [
  'subjectName',
  'subjectScientificName',
  'subjectCategory',
  'subjectTaxonKey',
  'subjectTaxonPath'
] as const

/** The draft fields a picked subject fills in. */
export const subjectPatch = (
  picked: PickedSubject
): Pick<MediaDetailsDraft, (typeof SUBJECT_DRAFT_KEYS)[number]> => ({
  subjectName: picked.name,
  subjectScientificName: picked.scientificName,
  subjectCategory: picked.category,
  subjectTaxonKey: picked.taxonKey,
  subjectTaxonPath: picked.taxonPath
})

/** Whether the draft already holds this picked subject. */
export const isSubjectPicked = (
  draft: MediaDetailsDraft,
  picked: PickedSubject
): boolean =>
  draft.subjectName.trim().toLowerCase() === picked.name.toLowerCase() &&
  draft.subjectScientificName.trim().toLowerCase() ===
    picked.scientificName.toLowerCase() &&
  draft.subjectTaxonKey === picked.taxonKey

// `subject_taxon_key` is digits, at most 12; anything else would fail the
// whole save, so it is treated as "no taxon".
const TAXON_KEY = /^\d{1,12}$/

const clean = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** The description that is actually saved: decorative means none. */
export const effectiveDescription = (
  draft: MediaDetailsDraft
): string | null => (draft.decorative ? null : clean(draft.description))

/**
 * Only the keys that differ from the original, in the wire shape of
 * `PUT /api/v1/media/:id`. Empty values clear (`null`), unchanged keys are
 * absent so the server leaves them alone.
 */
export const diffDraft = (
  original: MediaDetailsDraft,
  draft: MediaDetailsDraft
): UpdateMediaDetailsFields => {
  const fields: UpdateMediaDetailsFields = {}
  if (effectiveDescription(original) !== effectiveDescription(draft)) {
    fields.description = effectiveDescription(draft)
  }
  if (clean(original.subjectName) !== clean(draft.subjectName)) {
    fields.subject_name = clean(draft.subjectName)
  }
  if (
    clean(original.subjectScientificName) !== clean(draft.subjectScientificName)
  ) {
    fields.subject_scientific_name = clean(draft.subjectScientificName)
  }
  if (original.subjectCategory !== draft.subjectCategory) {
    fields.subject_category = draft.subjectCategory || null
  }
  // The server clears a stored taxon key whenever the name or scientific name
  // changes without a key in the same request, so a key the draft still holds
  // (a renamed common name for the same species) is sent along to keep it.
  const taxonKey = TAXON_KEY.test(draft.subjectTaxonKey)
    ? draft.subjectTaxonKey
    : ''
  const identityChanged =
    fields.subject_name !== undefined ||
    fields.subject_scientific_name !== undefined ||
    fields.subject_category !== undefined
  if (original.subjectTaxonKey !== draft.subjectTaxonKey) {
    fields.subject_taxon_key = taxonKey || null
  } else if (identityChanged && taxonKey) {
    fields.subject_taxon_key = taxonKey
  }
  if (original.cameraGearId !== draft.cameraGearId) {
    fields.camera_gear_id = draft.cameraGearId || null
  }
  if (original.lensGearId !== draft.lensGearId) {
    fields.lens_gear_id = draft.lensGearId || null
  }
  if (clean(original.placeName) !== clean(draft.placeName)) {
    fields.place_name = clean(draft.placeName)
  }
  if (original.placePrecision !== draft.placePrecision) {
    fields.place_precision = draft.placePrecision || null
  }
  if (original.inGallery !== draft.inGallery) {
    fields.in_gallery = draft.inGallery
  }
  return fields
}
