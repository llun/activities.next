export interface FitnessDeviceBrand {
  /** Canonical string key used for storage and lookups */
  key: string
  displayName: string
  url: string
  brandColor?: string
}

// Named brand constants — each brand defined once, referenced by all its keys
const GARMIN: FitnessDeviceBrand = {
  key: 'garmin',
  displayName: 'Garmin',
  url: 'https://www.garmin.com',
  brandColor: '#007CC3'
}
const WAHOO: FitnessDeviceBrand = {
  key: 'wahoo_fitness',
  displayName: 'Wahoo',
  url: 'https://www.wahoofitness.com'
}
const HAMMERHEAD: FitnessDeviceBrand = {
  key: 'hammerhead',
  displayName: 'Hammerhead',
  url: 'https://www.hammerhead.io'
}
const BRYTON: FitnessDeviceBrand = {
  key: 'bryton',
  displayName: 'Bryton',
  url: 'https://www.brytonsport.com'
}
const SIGMA: FitnessDeviceBrand = {
  key: 'sigma_sport',
  displayName: 'Sigma',
  url: 'https://www.sigmasport.com'
}
const POLAR: FitnessDeviceBrand = {
  key: 'polar',
  displayName: 'Polar',
  url: 'https://www.polar.com'
}
const SUUNTO: FitnessDeviceBrand = {
  key: 'suunto',
  displayName: 'Suunto',
  url: 'https://www.suunto.com'
}
const COROS: FitnessDeviceBrand = {
  key: 'coros',
  displayName: 'Coros',
  url: 'https://www.coros.com'
}

/** FIT SDK integer manufacturer codes and their string aliases */
const BRAND_MAP: Record<string | number, FitnessDeviceBrand> = {
  // Garmin: code 1
  1: GARMIN,
  garmin: GARMIN,

  // Wahoo Fitness: code 32
  32: WAHOO,
  wahoo_fitness: WAHOO,

  // Hammerhead: code 95
  95: HAMMERHEAD,
  hammerhead: HAMMERHEAD,

  // Bryton: code 267 only (code 64 belongs to North Pole Engineering / NPE)
  267: BRYTON,
  bryton: BRYTON,

  // Sigma Sport: codes 154, 80, 148
  154: SIGMA,
  80: SIGMA,
  148: SIGMA,
  sigma_sport: SIGMA,

  // Polar: code 14
  14: POLAR,
  polar: POLAR,

  // Suunto: code 23
  23: SUUNTO,
  suunto: SUUNTO,

  // Coros: code 434
  434: COROS,
  coros: COROS
}

const BRAND_PREFIXES: Array<{ prefix: string; brand: FitnessDeviceBrand }> = [
  { prefix: 'garmin', brand: GARMIN },
  { prefix: 'wahoo', brand: WAHOO },
  { prefix: 'hammerhead', brand: HAMMERHEAD },
  { prefix: 'bryton', brand: BRYTON },
  { prefix: 'sigma', brand: SIGMA },
  { prefix: 'polar', brand: POLAR },
  { prefix: 'suunto', brand: SUUNTO },
  { prefix: 'coros', brand: COROS }
]

/**
 * Look up brand info from a FIT manufacturer code (integer) or string alias.
 * Returns null for unknown manufacturers.
 */
export const getBrandFromManufacturer = (
  manufacturer: number | string | undefined | null
): FitnessDeviceBrand | null => {
  if (manufacturer === undefined || manufacturer === null) return null
  const key =
    typeof manufacturer === 'number'
      ? manufacturer
      : manufacturer.toLowerCase().trim()
  return BRAND_MAP[key] ?? null
}

/**
 * Parse brand info from a free-text device name string (e.g. Strava's device_name).
 * Checks for known brand names as a prefix in the string.
 */
export const getBrandFromDeviceName = (
  deviceName: string | undefined | null
): FitnessDeviceBrand | null => {
  if (!deviceName) return null
  const lower = deviceName.toLowerCase().trim()
  for (const { prefix, brand } of BRAND_PREFIXES) {
    if (lower.startsWith(prefix)) return brand
  }
  return null
}

/**
 * Derive a normalized manufacturer key string from a free-text device name.
 * Returns the string alias (e.g. "garmin") or undefined for unknown brands.
 */
export const getManufacturerKeyFromDeviceName = (
  deviceName: string | undefined | null
): string | undefined => {
  return getBrandFromDeviceName(deviceName)?.key
}
