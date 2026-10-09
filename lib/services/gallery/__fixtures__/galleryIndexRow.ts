import type { GalleryIndexRow } from '@/lib/database/sql/galleryMedia'

/**
 * A light gallery index row with no subject and no place; `overrides` set what
 * a test is about. `takenAt` defaults to noon UTC on 2026-09-12.
 */
export const buildIndexRow = (
  id: string | number,
  overrides: Partial<GalleryIndexRow> = {}
): GalleryIndexRow => ({
  id: String(id),
  subjectName: null,
  subjectScientificName: null,
  subjectCategory: null,
  subjectTaxonKey: null,
  subjectTaxonPath: null,
  subjectIucnCategory: null,
  subjectLookupStatus: null,
  placeName: null,
  placePrecision: null,
  placeLatitude: null,
  placeLongitude: null,
  placeCountryCode: null,
  placeNameSource: null,
  takenAt: Date.UTC(2026, 8, 12, 12),
  createdAt: Date.UTC(2026, 9, 1),
  ...overrides
})

/** A row with a public, owner-named place at exact precision. */
export const buildPlacedRow = (
  id: string | number,
  placeName: string,
  overrides: Partial<GalleryIndexRow> = {}
): GalleryIndexRow =>
  buildIndexRow(id, {
    placeName,
    placePrecision: 'exact',
    placeLatitude: 10.5,
    placeLongitude: 20.5,
    placeNameSource: 'owner',
    ...overrides
  })
