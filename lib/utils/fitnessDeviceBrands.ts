export interface FitnessDeviceBrand {
  displayName: string
  url: string
  brandColor?: string
}

const BRAND_MAP: Record<string | number, FitnessDeviceBrand> = {
  // Garmin: code 1, string "garmin"
  1: { displayName: 'Garmin', url: 'https://www.garmin.com', brandColor: '#007CC3' },
  garmin: { displayName: 'Garmin', url: 'https://www.garmin.com', brandColor: '#007CC3' },

  // Wahoo Fitness: code 32, string "wahoo_fitness"
  32: { displayName: 'Wahoo', url: 'https://www.wahoofitness.com' },
  wahoo_fitness: { displayName: 'Wahoo', url: 'https://www.wahoofitness.com' },

  // Hammerhead: code 95
  95: { displayName: 'Hammerhead', url: 'https://www.hammerhead.io' },
  hammerhead: { displayName: 'Hammerhead', url: 'https://www.hammerhead.io' },

  // Bryton: codes 267, 64
  267: { displayName: 'Bryton', url: 'https://www.brytonsport.com' },
  64: { displayName: 'Bryton', url: 'https://www.brytonsport.com' },
  bryton: { displayName: 'Bryton', url: 'https://www.brytonsport.com' },

  // Sigma Sport: codes 154, 80, 148
  154: { displayName: 'Sigma', url: 'https://www.sigmasport.com' },
  80: { displayName: 'Sigma', url: 'https://www.sigmasport.com' },
  148: { displayName: 'Sigma', url: 'https://www.sigmasport.com' },
  sigma_sport: { displayName: 'Sigma', url: 'https://www.sigmasport.com' },

  // Polar: code 14
  14: { displayName: 'Polar', url: 'https://www.polar.com' },
  polar: { displayName: 'Polar', url: 'https://www.polar.com' },

  // Suunto: code 23
  23: { displayName: 'Suunto', url: 'https://www.suunto.com' },
  suunto: { displayName: 'Suunto', url: 'https://www.suunto.com' },

  // Coros: code 434
  434: { displayName: 'Coros', url: 'https://www.coros.com' },
  coros: { displayName: 'Coros', url: 'https://www.coros.com' }
}

const BRAND_PREFIXES: Array<{ prefix: string; key: string }> = [
  { prefix: 'garmin', key: 'garmin' },
  { prefix: 'wahoo', key: 'wahoo_fitness' },
  { prefix: 'hammerhead', key: 'hammerhead' },
  { prefix: 'bryton', key: 'bryton' },
  { prefix: 'sigma', key: 'sigma_sport' },
  { prefix: 'polar', key: 'polar' },
  { prefix: 'suunto', key: 'suunto' },
  { prefix: 'coros', key: 'coros' }
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
  for (const { prefix, key } of BRAND_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return BRAND_MAP[key] ?? null
    }
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
  if (!deviceName) return undefined
  const lower = deviceName.toLowerCase().trim()
  for (const { prefix, key } of BRAND_PREFIXES) {
    if (lower.startsWith(prefix)) return key
  }
  return undefined
}
