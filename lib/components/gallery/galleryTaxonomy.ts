// Client-safe helpers the gallery and viewer UI share for taxonomy and country
// text. The server has its own copies behind database-bound modules
// (`countryDisplayName`, `toSubjectHashtag`); these are pure so a client
// component can import them without pulling server code into the bundle.

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

/**
 * The scientific-name hashtag a post carries when its author turned subject
 * hashtags on: `Alcedo atthis` -> `AlcedoAtthis`. Only a name of two or more
 * words has one; the genus and species are used, so a subspecies shares its
 * species' tag. Null otherwise.
 */
export const toScientificHashtag = (
  scientificName: string | null | undefined
): string | null => {
  const words = (scientificName ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
  if (words.length < 2) return null
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}

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
