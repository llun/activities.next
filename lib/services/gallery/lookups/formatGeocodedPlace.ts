const LOCALITY_KEYS = [
  'city',
  'town',
  'village',
  'municipality',
  'county',
  'state_district',
  'state'
] as const

const MAX_PLACE_NAME_LENGTH = 255

export interface GeocodedPlace {
  name: string | null
  // ISO 3166-1 alpha-2, upper case.
  countryCode: string | null
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

/**
 * Turns a Nominatim `reverse` answer (jsonv2, addressdetails=1) into a short
 * place name: the first of city, town, village, municipality, county, state
 * district and state, then ", <country>". A cell near a border can get the
 * neighbouring country; that is accepted.
 *
 * Returns null when the answer names nothing at all (open sea, an error body).
 */
export const formatGeocodedPlace = (raw: unknown): GeocodedPlace | null => {
  if (!raw || typeof raw !== 'object') return null
  const address = (raw as { address?: unknown }).address
  if (!address || typeof address !== 'object') return null
  const fields = address as Record<string, unknown>

  const locality = LOCALITY_KEYS.map((key) => text(fields[key])).find(Boolean)
  const country = text(fields.country)
  const rawCode = text(fields.country_code)?.toUpperCase() ?? null
  const countryCode = rawCode && /^[A-Z]{2}$/.test(rawCode) ? rawCode : null

  const name = [locality, country].filter(Boolean).join(', ')
  if (!name && !countryCode) return null

  return {
    name: name ? name.slice(0, MAX_PLACE_NAME_LENGTH) : null,
    countryCode
  }
}
