import type { GearEntity } from '@/lib/services/fitness-gears/gearEntities'

/**
 * Presentation helpers shared by the gear list, the gear detail page and the
 * add/edit dialog. Everything here is pure so the boundaries (wear thresholds,
 * unit conversions) can be unit-tested without rendering a component.
 *
 * Distances arrive from the API in METERS and weights in KILOGRAMS; nothing in
 * the UI stores a converted value, it only formats one.
 */

// `formatFitnessDistance` in lib/utils/fitness.ts deliberately has no thousands
// separator (it renders inside compact stat grids). A lifetime gear total is
// five digits often enough that it needs one — "35,253.7 km", not "35253.7 km".
const oneDecimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})

const integerFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0
})

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric'
})

export const formatGearDistanceKm = (meters: number): string =>
  `${oneDecimalFormatter.format(meters / 1000)} km`

export const formatKmInt = (meters: number): string =>
  `${integerFormatter.format(meters / 1000)} km`

export const formatWeightKg = (kilograms: number): string =>
  `${oneDecimalFormatter.format(kilograms)} kg`

export const formatGearDate = (milliseconds: number): string =>
  dateFormatter.format(new Date(milliseconds))

/**
 * The gear's stored `name` is always the label to show — the dialog derives it
 * from the nickname, then "brand model", before submitting. The fallbacks here
 * only cover a row written outside that flow (an import, an older API client).
 */
export const getGearDisplayName = (
  gear: Pick<GearEntity, 'name' | 'brand' | 'model' | 'kind'>
): string => {
  const name = gear.name.trim()
  if (name) return name

  const brandModel = [gear.brand, gear.model]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ')
  if (brandModel) return brandModel

  return gear.kind === 'bike' ? 'Bike' : 'Shoes'
}

export type GearWearLevel = 'ok' | 'due-soon' | 'overdue'

export interface GearWearState {
  level: GearWearLevel
  /** Uncapped percentage — a 150%-worn chain still reports 150. */
  percent: number
  /** Capped at 100% so the fill never overflows its track. */
  barWidth: string
  barClassName: string
  caption: string
  captionClassName: string
}

/**
 * Wear against a component's service interval. Returns null when no interval is
 * set — most components never get one, and an absent reminder must not render
 * as "0% worn".
 */
export const getWearState = (
  distanceMeters: number,
  serviceDistanceMeters: number | null | undefined
): GearWearState | null => {
  if (!serviceDistanceMeters || serviceDistanceMeters <= 0) return null

  const percent = (distanceMeters / serviceDistanceMeters) * 100
  const barWidth = `${Math.min(100, Math.max(0, percent))}%`

  if (percent >= 100) {
    return {
      level: 'overdue',
      percent,
      barWidth,
      barClassName: 'bg-destructive',
      caption: 'replace due',
      captionClassName: 'text-destructive'
    }
  }

  if (percent >= 85) {
    return {
      level: 'due-soon',
      percent,
      barWidth,
      barClassName: 'bg-amber-500',
      caption: 'due soon',
      captionClassName: 'text-amber-600 dark:text-amber-500'
    }
  }

  return {
    level: 'ok',
    percent,
    barWidth,
    barClassName: 'bg-primary',
    caption: `of ${formatKmInt(serviceDistanceMeters)}`,
    captionClassName: 'text-muted-foreground'
  }
}

/**
 * Stored verbatim in `fitness_gears.bikeType` (a free-form varchar), so the
 * option value is the label the detail page's meta line renders back.
 */
export const BIKE_TYPE_OPTIONS = [
  'Road bike',
  'Gravel bike',
  'Mountain bike',
  'Folding bike',
  'Commuter',
  'E-bike',
  'Time trial'
] as const

export const COMPONENT_TYPE_OPTIONS = [
  'Chain',
  'Cassette',
  'Chainrings',
  'Front tire',
  'Rear tire',
  'Front brake pads',
  'Rear brake pads',
  'Saddle',
  'Handlebar',
  'Stem',
  'Seatpost',
  'Pedals',
  'Front wheel',
  'Rear wheel',
  'Fork',
  'Headset',
  'Bottom bracket',
  'Front shock',
  'Rear shock'
] as const
