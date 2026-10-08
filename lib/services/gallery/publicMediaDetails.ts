import { Database } from '@/lib/database/types'
import { MediaPublicDetails } from '@/lib/services/gallery/galleryEntities'
import { isInGalleryHiddenLocation } from '@/lib/services/gallery/hiddenLocations'
import { isPlaceWithheldForThreat } from '@/lib/services/gallery/threatenedSpecies'
import {
  EMPTY_MEDIA_DETAILS,
  GalleryHiddenLocation,
  GallerySettings,
  MediaDetailsRecord,
  MediaExposure
} from '@/lib/types/database/gallery'
import { Media } from '@/lib/types/database/operations'

export {
  THREATENED_IUCN,
  isPlaceWithheldForThreat,
  isSpeciesLike
} from '@/lib/services/gallery/threatenedSpecies'

// An `area` place is snapped to a 0.05 degree grid: about 5.5 km north-south
// everywhere, and about 5.5 km east-west at the equator, narrowing towards the
// poles. The cell centre, not the true point, is what is disclosed.
export const AREA_PRECISION_DEGREES = 0.05

export const snapToGrid = (value: number): number => {
  const snapped =
    Math.round(value / AREA_PRECISION_DEGREES) * AREA_PRECISION_DEGREES
  // 0.05 steps accumulate float noise (51.550000000000004); two decimals is the
  // grid's own resolution.
  return Number((snapped === 0 ? 0 : snapped).toFixed(2))
}

export type PublicPlace = NonNullable<MediaPublicDetails['place']>

/**
 * Everything the public place rule reads. Every field is required, so a call
 * site cannot spread `EMPTY_MEDIA_DETAILS` over a partial row and silently
 * pass "no subject" — which would read as "not a species" and disclose a
 * threatened species' place. `PUBLIC_PLACE_INPUT_KEYS` lists them for the
 * guard tests.
 */
export const PUBLIC_PLACE_INPUT_KEYS = [
  'placeName',
  'placePrecision',
  'placeLatitude',
  'placeLongitude',
  'placeCountryCode',
  'placeNameSource',
  'subjectName',
  'subjectScientificName',
  'subjectCategory',
  'subjectTaxonKey',
  'subjectIucnCategory',
  'subjectLookupStatus'
] as const satisfies readonly (keyof MediaDetailsRecord)[]

export type PublicPlaceInput = Pick<
  MediaDetailsRecord,
  (typeof PUBLIC_PLACE_INPUT_KEYS)[number]
>

export interface PublicPlaceSettings {
  hiddenLocations: readonly GalleryHiddenLocation[]
  hideThreatenedPlaces: boolean
}

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/

let regionNames: Intl.DisplayNames | null | undefined
const getRegionNames = (): Intl.DisplayNames | null => {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], {
        type: 'region',
        fallback: 'none'
      })
    } catch {
      regionNames = null
    }
  }
  return regionNames
}

/** The English name of an ISO 3166-1 alpha-2 code, or null when unknown. */
export const countryDisplayName = (
  countryCode: string | null | undefined
): string | null => {
  if (!countryCode || !COUNTRY_CODE_PATTERN.test(countryCode)) return null
  // `ZZ` is CLDR's "Unknown Region", not a country.
  if (countryCode === 'ZZ') return null
  try {
    const name = getRegionNames()?.of(countryCode)
    // `of` echoes an unknown code back rather than failing.
    return name && name !== countryCode ? name : null
  } catch {
    return null
  }
}

/** A stored country code, or null when it is not a valid alpha-2 code. */
export const toCountryCode = (
  countryCode: string | null | undefined
): string | null =>
  countryCode && COUNTRY_CODE_PATTERN.test(countryCode) ? countryCode : null

/**
 * The place a viewer other than the owner is shown. The stored coordinates are
 * never returned as they are unless the owner chose `exact`.
 *
 * Null — no name, no precision, nothing — when:
 * - the subject is a species-like subject not yet cleared as not threatened
 *   and the owner hides threatened species' places (`isPlaceWithheldForThreat`;
 *   it overrides the precision, and fails closed while a lookup is pending,
 *   failed or disabled),
 * - the precision is `hidden`, or there is neither a precision nor a name,
 * - there is no precision and the name is the geocoder's, not the owner's,
 * - the place falls inside one of the owner's hidden locations. That test runs
 *   on the stored point AND on the point that would be disclosed: an `area`
 *   cell centre can land inside a zone the true point is just outside of, and
 *   publishing that centre would put a pin in the very place the owner hid. It
 *   applies whatever the precision, so a `country` name is withheld too.
 *
 * A place with no precision never carries a country code: the owner's name
 * ("Home") is all they chose to show.
 *
 * A `country` place is named by its country code when one is known, so a
 * geocoded "Pak Chong, Thailand" leaks no more than "Thailand". With no
 * usable code a geocoded name is not shown at all (it names the town, and
 * without a code there is no telling which part is the country); an owner's
 * own name is theirs to show. Both settings are required so no caller can
 * forget either rule.
 */
export const getPublicPlace = (
  details: PublicPlaceInput,
  { hiddenLocations, hideThreatenedPlaces }: PublicPlaceSettings
): PublicPlace | null => {
  if (isPlaceWithheldForThreat(details, { hideThreatenedPlaces })) return null

  const { placeName, placePrecision, placeLatitude, placeLongitude } = details
  const countryCode = toCountryCode(details.placeCountryCode)

  if (placePrecision === 'hidden') return null
  if (placeName === null && placePrecision === null) return null
  // With no precision the owner never chose to show anything; only a name
  // they typed themselves (or one from before lookups existed) is theirs to
  // show. A geocoded name names the town of a point they never published.
  if (placePrecision === null && details.placeNameSource === 'geocoder') {
    return null
  }

  const place: PublicPlace = {
    name:
      placePrecision === 'country'
        ? (countryDisplayName(countryCode) ??
          (details.placeNameSource === 'geocoder' ? null : placeName))
        : placeName,
    precision: placePrecision,
    // With no precision the owner chose to show only their own name: the
    // code is the geocoder's reading of a point they never published, and
    // would add the country to the public country counts too.
    countryCode: placePrecision === null ? null : countryCode
  }
  // A `country` place left with neither a name nor a code discloses nothing
  // worth a place block.
  if (placePrecision === 'country' && place.name === null && !countryCode) {
    return null
  }
  const hasCoordinates = placeLatitude !== null && placeLongitude !== null
  if (hasCoordinates && placePrecision === 'exact') {
    place.latitude = placeLatitude
    place.longitude = placeLongitude
  } else if (hasCoordinates && placePrecision === 'area') {
    place.latitude = snapToGrid(placeLatitude)
    place.longitude = snapToGrid(placeLongitude)
  }

  if (hiddenLocations.length > 0) {
    if (
      hasCoordinates &&
      isInGalleryHiddenLocation(placeLatitude, placeLongitude, hiddenLocations)
    ) {
      return null
    }
    if (
      place.latitude !== undefined &&
      place.longitude !== undefined &&
      isInGalleryHiddenLocation(
        place.latitude,
        place.longitude,
        hiddenLocations
      )
    ) {
      return null
    }
  }
  return place
}

/** The subject block, or null when the media names nothing at all. */
export const toSubjectEntity = (
  details: Pick<
    MediaDetailsRecord,
    | 'subjectName'
    | 'subjectScientificName'
    | 'subjectCategory'
    | 'subjectTaxonKey'
    | 'subjectTaxonPath'
  >
): MediaPublicDetails['subject'] =>
  details.subjectName ||
  details.subjectScientificName ||
  details.subjectCategory
    ? {
        name: details.subjectName,
        scientificName: details.subjectScientificName,
        category: details.subjectCategory,
        // Public species facts. The IUCN category and lookup status are never
        // part of this entity.
        taxonKey: details.subjectTaxonKey ?? null,
        taxonPath: details.subjectTaxonPath ?? null
      }
    : null

export const toTakenAtIso = (takenAt: number | null): string | null =>
  takenAt === null ? null : new Date(takenAt).toISOString()

export const toExposureEntity = (
  exposure: MediaExposure | null
): MediaPublicDetails['exposure'] =>
  exposure
    ? {
        focalLengthMm: exposure.focalLengthMm ?? null,
        aperture: exposure.aperture ?? null,
        exposureTime: exposure.exposureTime ?? null,
        iso: exposure.iso ?? null
      }
    : null

/**
 * The public-safe projection of a media's details. Visibility of the media
 * itself (that it hangs off a status the viewer may read) is the caller's
 * business; this decides only what of the details may leave.
 */
export const buildPublicMediaDetails = async ({
  database,
  media,
  settings
}: {
  database: Pick<Database, 'getGalleryGearNamesByIds'>
  media: Media
  settings: Pick<
    GallerySettings,
    'showGear' | 'hiddenLocations' | 'hideThreatenedPlaces'
  >
}): Promise<MediaPublicDetails> => {
  const details = { ...EMPTY_MEDIA_DETAILS, ...media.details }

  const gearIds = settings.showGear
    ? [details.cameraGearId, details.lensGearId].filter((id): id is string =>
        Boolean(id)
      )
    : []
  const names =
    gearIds.length > 0
      ? await database.getGalleryGearNamesByIds({ ids: gearIds })
      : {}
  const toGear = (id: string | null) =>
    id && names[id] ? { name: names[id] } : null

  const exposure = settings.showGear ? details.exposure : null

  return {
    subject: toSubjectEntity(details),
    takenAt: toTakenAtIso(details.takenAt),
    camera: toGear(details.cameraGearId),
    lens: toGear(details.lensGearId),
    exposure: toExposureEntity(exposure),
    place: getPublicPlace(details, {
      hiddenLocations: settings.hiddenLocations,
      hideThreatenedPlaces: settings.hideThreatenedPlaces
    })
  }
}
