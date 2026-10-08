// Client-safe helpers the gallery and viewer UI share for taxonomy and country
// text. The server has its own copies behind database-bound modules
// (`countryDisplayName`); these are pure so a client
// component can import them without pulling server code into the bundle.
import { toScientificHashtag as sharedToScientificHashtag } from '@/lib/utils/text/subjectHashtagRules'

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/

let regionNames: Intl.DisplayNames | null | undefined

/** The English name of an ISO 3166-1 alpha-2 code, or null when unknown. */
export const getCountryName = (
  countryCode: string | null | undefined
): string | null => {
  if (!countryCode || !COUNTRY_CODE_PATTERN.test(countryCode)) return null
  if (countryCode === 'ZZ') return null
  try {
    if (regionNames === undefined) {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' })
    }
    const name = regionNames?.of(countryCode)
    // `of` echoes an unknown code back rather than failing.
    return name && name !== countryCode ? name : null
  } catch {
    regionNames = null
    return null
  }
}

/**
 * Up to `limit` country names, then "+N" for the rest ("Costa Rica, Panama +2").
 * Codes with no known name are skipped. Null when none has a name.
 */
export const formatCountryNames = (
  countryCodes: readonly string[],
  limit = 3
): string | null => {
  const names = countryCodes.flatMap((code) => {
    const name = getCountryName(code)
    return name ? [name] : []
  })
  if (names.length === 0) return null
  const shown = names.slice(0, limit).join(', ')
  return names.length > limit ? `${shown} +${names.length - limit}` : shown
}

/** "1 country" / "5 countries". */
export const formatCountryCount = (count: number): string =>
  `${count.toLocaleString('en-US')} ${count === 1 ? 'country' : 'countries'}`

/** "Animalia › Chordata › Aves", or null for an empty or missing path. */
export const formatTaxonPath = (
  taxonPath: readonly string[] | null | undefined
): string | null => {
  const names = (taxonPath ?? []).map((name) => name.trim()).filter(Boolean)
  return names.length > 0 ? names.join(' › ') : null
}

/** The GBIF species page for a taxon key (digits only), or null. */
export const getGbifSpeciesHref = (
  taxonKey: string | null | undefined
): string | null =>
  taxonKey && /^\d{1,12}$/.test(taxonKey)
    ? `https://www.gbif.org/species/${taxonKey}`
    : null

// The one shared rule (also used when a post gets its tags): only a
// well-formed binomial has a tag, and a subspecies shares its species' tag.
export const toScientificHashtag = (
  scientificName: string | null | undefined
): string | null => sharedToScientificHashtag(scientificName ?? '')

export const getHashtagHref = (tag: string): string =>
  `/tags/${encodeURIComponent(tag)}`

/**
 * "1,008 photos and videos with a place · 7 countries". The countries are left
 * out when unknown (null), not shown as 0.
 */
export const formatGalleryMapSummary = (
  count: number,
  countryCount: number | null | undefined
): string => {
  const items = `${count.toLocaleString('en-US')} ${count === 1 ? 'photo or video' : 'photos and videos'} with a place`
  return countryCount != null && countryCount > 0
    ? `${items} · ${formatCountryCount(countryCount)}`
    : items
}
