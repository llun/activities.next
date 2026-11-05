/**
 * Training zones from an athlete's own numbers: heart-rate zones from a max
 * heart rate (with a resting heart rate, from the heart-rate reserve), and
 * power zones from a functional threshold power.
 *
 * Dependency-free: the activity page buckets samples with these in the
 * browser, and the Fitness → Zones form previews them while the athlete types.
 */

export interface TrainingZoneDefinition {
  /** Z1, Z2, … */
  name: string
  label: string
  /** Inclusive lower bound. */
  lo: number
  /** Exclusive upper bound, null for the top zone. */
  hi: number | null
  color: string
}

/** The athlete's inputs, as the `general` fitness settings row holds them. */
export interface TrainingZoneSettings {
  maxHeartRate?: number | null
  restingHeartRate?: number | null
  functionalThresholdPower?: number | null
}

export const ZONE_COLORS = [
  'hsl(205 45% 62%)',
  'hsl(142 60% 45%)',
  'hsl(45 92% 50%)',
  'hsl(24 95% 50%)',
  'hsl(2 78% 55%)'
]

const HEART_RATE_LABELS = [
  'Recovery',
  'Endurance',
  'Tempo',
  'Threshold',
  'Anaerobic'
]

const POWER_LABELS = [
  'Active recovery',
  'Endurance',
  'Tempo',
  'Threshold',
  'VO2 max',
  'Anaerobic'
]

/** Zone lower bounds as a share of max heart rate. */
const MAX_HEART_RATE_SHARES = [0, 0.66, 0.76, 0.85, 0.92]
/** Zone lower bounds as a share of heart-rate reserve (Karvonen). */
const HEART_RATE_RESERVE_SHARES = [0, 0.6, 0.7, 0.8, 0.9]
/** Zone lower bounds as a share of FTP (Coggan). */
const FTP_SHARES = [0, 0.55, 0.75, 0.9, 1.05, 1.2]

export const MAX_HEART_RATE_RANGE = { min: 100, max: 240 }
export const RESTING_HEART_RATE_RANGE = { min: 30, max: 120 }
export const FUNCTIONAL_THRESHOLD_POWER_RANGE = { min: 50, max: 700 }

const buildZones = (
  lowerBounds: number[],
  labels: string[]
): TrainingZoneDefinition[] =>
  lowerBounds.map((lo, index) => ({
    name: `Z${index + 1}`,
    label: labels[index],
    lo,
    hi: index + 1 < lowerBounds.length ? lowerBounds[index + 1] : null,
    // The sixth power zone repeats the last colour.
    color: ZONE_COLORS[Math.min(index, ZONE_COLORS.length - 1)]
  }))

/** The fixed zones every activity used before personal zones existed. */
export const DEFAULT_HEART_RATE_ZONES: TrainingZoneDefinition[] = buildZones(
  [0, 122, 142, 158, 172],
  HEART_RATE_LABELS
)

const isPositive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/**
 * The athlete's heart-rate zones, or null without a max heart rate. With a
 * resting heart rate below it, each bound is resting + share × (max − resting);
 * otherwise a share of max. Z1 always starts at 0, so a reading below the
 * first bound still counts as recovery.
 */
export const getHeartRateZones = (
  settings: TrainingZoneSettings | null | undefined
): TrainingZoneDefinition[] | null => {
  const max = settings?.maxHeartRate
  if (!isPositive(max)) return null
  const resting = settings?.restingHeartRate
  const bounds =
    isPositive(resting) && resting < max
      ? HEART_RATE_RESERVE_SHARES.map((share, index) =>
          index === 0 ? 0 : Math.round(resting + share * (max - resting))
        )
      : MAX_HEART_RATE_SHARES.map((share) => Math.round(share * max))
  return buildZones(bounds, HEART_RATE_LABELS)
}

/** The athlete's six power zones, or null without an FTP. */
export const getPowerZones = (
  settings: TrainingZoneSettings | null | undefined
): TrainingZoneDefinition[] | null => {
  const ftp = settings?.functionalThresholdPower
  if (!isPositive(ftp)) return null
  return buildZones(
    FTP_SHARES.map((share) => Math.round(share * ftp)),
    POWER_LABELS
  )
}

/** "< 123 bpm", "123–141 bpm", "171+ bpm". */
export const formatZoneRange = (zone: TrainingZoneDefinition, unit: string) => {
  if (zone.lo === 0 && zone.hi !== null) return `< ${zone.hi} ${unit}`
  if (zone.hi === null) return `${zone.lo}+ ${unit}`
  return `${zone.lo}–${zone.hi} ${unit}`
}
