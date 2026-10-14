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

  // Hammerhead: code 289 (not 95 — that is stryd)
  289: HAMMERHEAD,
  hammerhead: HAMMERHEAD,

  // Bryton: code 267 only (code 64 belongs to North Pole Engineering / NPE)
  267: BRYTON,
  bryton: BRYTON,

  // Sigma Sport: code 70 (FIT string: sigmasport; codes 80/148/154 are lifebeam/segment_id/polar)
  70: SIGMA,
  sigma_sport: SIGMA,
  sigmasport: SIGMA,

  // Polar: codes 123 (polar_electro) and 154 (polar); code 14 is nautilus
  123: POLAR,
  154: POLAR,
  polar: POLAR,
  polar_electro: POLAR,

  // Suunto: code 23
  23: SUUNTO,
  suunto: SUUNTO,

  // Coros: code 294 (not 434 — that is unassigned)
  294: COROS,
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

/**
 * Compute the display label that BrandedDeviceLink would render for the given
 * device fields.  Returns null when there is nothing useful to show — notably
 * when deviceManufacturer is a raw numeric string for an unrecognised FIT code.
 *
 * Use this to guard parent containers so that "Recorded with" / "Via:" labels
 * are not rendered without accompanying content.
 */
export const getDeviceDisplayLabel = (
  deviceName: string | undefined | null,
  deviceManufacturer: string | undefined | null
): string | null => {
  const brand =
    getBrandFromManufacturer(deviceManufacturer) ??
    getBrandFromDeviceName(deviceName)
  const numericOnlyManufacturer =
    !!deviceManufacturer && /^\d+$/.test(deviceManufacturer)
  const numericOnlyDeviceName = !!deviceName && /^\d+$/.test(deviceName)
  const usableDeviceName = deviceName?.trim() || null
  return (
    (!numericOnlyDeviceName ? usableDeviceName : null) ||
    brand?.displayName ||
    (!numericOnlyManufacturer ? deviceManufacturer : null) ||
    null
  )
}

export type DeviceLinkTarget =
  | { kind: 'owner'; href: string; label: string }
  | {
      kind: 'brand'
      href: string
      label: string
      brandName: string
      brandColor?: string
    }

/**
 * Where the device an activity was recorded on links to, for this viewer, or
 * null when it is plain text. The one place that decides it, for
 * `BrandedDeviceLink` and the recording picker's device item alike:
 *
 * - the owner, with a `kind: 'device'` gear row: that row's own page (owner
 *   scoped, so nobody else is ever sent there);
 * - everyone else, and the owner without a row: the manufacturer, when the
 *   brand resolves;
 * - otherwise nothing.
 *
 * `label` is what `BrandedDeviceLink` shows: the gear row's name over the
 * recorded one.
 */
export const getDeviceLinkTarget = ({
  deviceName,
  deviceManufacturer,
  deviceGearId,
  deviceGearName,
  isOwner
}: {
  deviceName?: string | null
  deviceManufacturer?: string | null
  deviceGearId?: string | null
  deviceGearName?: string | null
  isOwner?: boolean
}): DeviceLinkTarget | null => {
  const label =
    deviceGearName?.trim() ||
    getDeviceDisplayLabel(deviceName, deviceManufacturer)
  if (!label) return null

  if (isOwner && deviceGearId) {
    return {
      kind: 'owner',
      href: `/fitness/gear/${encodeURIComponent(deviceGearId)}`,
      label
    }
  }

  const brand =
    getBrandFromManufacturer(deviceManufacturer) ??
    getBrandFromDeviceName(deviceName)
  if (brand) {
    return {
      kind: 'brand',
      href: brand.url,
      label,
      brandName: brand.displayName,
      brandColor: brand.brandColor
    }
  }
  return null
}
