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

// Rendered in UTC, like every other instant in the fitness area (see
// `formatUtcDate` on the activity detail page). A gear or component date is a
// calendar day, not a moment: `<input type="date">` hands over "2024-03-01",
// which the spec parses as UTC midnight, so formatting it in the reader's local
// zone renders "Feb 29, 2024" for everyone west of UTC.
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
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

  if (gear.kind === 'bike') return 'Bike'
  return gear.kind === 'device' ? 'Device' : 'Shoes'
}

/**
 * The hostname a product link is shown as ("garmin.com", not the full URL),
 * with `www.` dropped because it is noise in a table cell.
 *
 * Returns null for anything that is not an http(s) URL, and both render sites
 * gate the anchor on this — so it is the check that decides whether the stored
 * value is ever used as an `href`. The protocol allowlist is the load-bearing
 * half: `new URL` parses an authority for non-special schemes too, so
 * `javascript://evil.example/%0aalert(1)` yields a perfectly good hostname and
 * would otherwise render as a link that executes on click.
 *
 * The API validates the column on write, so this is defence in depth — but rows
 * predating that validation, and anything a future importer writes, reach these
 * tables without passing through it.
 */
export const getProductUrlHostname = (
  url: string | null | undefined
): string | null => {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

export type GearWearLevel = 'ok' | 'due-soon' | 'overdue'

export interface GearWearState {
  level: GearWearLevel
  /** Uncapped percentage — a 150%-worn chain still reports 150. */
  percent: number
  /**
   * `percent` capped to 0–100. `aria-valuenow` has to sit inside
   * `aria-valuemin`/`aria-valuemax`, so the progressbar reports this and puts
   * the real number in `aria-valuetext`.
   */
  barPercent: number
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
  const barPercent = Math.min(100, Math.max(0, percent))
  const barWidth = `${barPercent}%`

  if (percent >= 100) {
    return {
      level: 'overdue',
      percent,
      barPercent,
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
      barPercent,
      barWidth,
      barClassName: 'bg-amber-500',
      caption: 'due soon',
      captionClassName: 'text-amber-600 dark:text-amber-500'
    }
  }

  return {
    level: 'ok',
    percent,
    barPercent,
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

// Table chrome, shared by the gear list's three tables and the components table
// on a gear's page so they cannot drift apart.
//
// The design system's gear tables (`ui_kits/web/GearKit.jsx`) pin the first
// column: the data columns scroll under it while the row's subject stays put,
// with a hairline down its right edge. That hairline is the table's structure —
// its only vertical rule, and what separates each row's subject from its
// numbers. Rendered as plain columns with no rule, as these were, the rows read
// as loose text.
//
// The column's surface is `bg-card`, the same grey as the card behind it, and
// the hairline is the only thing separating the two. That is what the design
// does: `useGKSnapCols` pins the cell with `background: 'white'`, and every
// card holding one of these tables is `bg-white/80`, so the lane is painted the
// CARD's own colour. The literal white is there to make the sticky cell opaque,
// not to step it off anything — there is no recessed lane anywhere in the kit.
//
// `bg-background` copied that literal colour instead of the relationship, and so
// broke it in BOTH themes. The kit is a static prototype that hardcodes white
// rather than reading `--card`, while its `app/globals.css` carries the same
// tokens this app has (light `--background` 100% / `--card` 98%, dark 3.9% /
// 9%). Against a `bg-card` table, then, `bg-background` came out a bright white
// stripe in light mode — a third of the table's width on a phone — and a well
// sunk below the card in dark. Taking the card's token gives the design's
// relationship in both.
//
// Whatever the colour, it has to be OPAQUE: a sticky cell with a transparent
// background lets the data columns scroll straight through it. That rules out
// `bg-card/50` and friends, and it is why the hover below is the opaque
// `bg-muted`.
//
// The divider is an inset shadow rather than a `border-r` because
// `border-collapse: collapse` (Tailwind's preflight default for tables) hands
// border painting to the table, which drops a sticky cell's own right border.
//
// The pinned width is deliberately NOT baked in: the design pins the gear and
// device tables at 150px but the denser seven-column components table at 104px,
// so each caller adds its own `min-w-[…]`. The components table then departs
// from the design's number — see `TYPE_COLUMN_WIDTH` — because our pinned cell
// keeps more of that width as padding, which is a per-caller decision precisely
// because it lives with the caller's padding.
export const STICKY_COLUMN =
  'sticky left-0 z-1 bg-card shadow-[inset_-1px_0_0_var(--border)]'

/**
 * Pinned first cell of a row that is itself clickable. The row's hover colour
 * has to be repeated here because this cell paints its own background over the
 * row's — without it the pinned column stays unlit while the rest of the row
 * highlights.
 *
 * Both surfaces use the OPAQUE `bg-muted`, never `bg-muted/50`. A translucent
 * hover does not layer over the cell's own `bg-card`, it replaces it, so the
 * cell would be 50% transparent precisely while the pointer is on the row — the
 * scrolled-under columns ghosting through in the one state a pinned column most
 * needs to be solid — and it would composite two tint layers against the row's
 * one, reading as a seam down the first column.
 *
 * A table whose rows are inert uses `STICKY_COLUMN` instead. The failure it
 * avoids is specifically a row carrying `group` but no `hover:` of its own,
 * which lights the first column alone; on a row with neither — what the
 * components table's rows are — the variant simply never matches and nothing
 * lights, so the wrong constant there is dead weight rather than a visible bug.
 */
export const STICKY_CLICKABLE_COLUMN = `${STICKY_COLUMN} group-hover:bg-muted`
