/**
 * Range logic for the fitness overview: presets, calendar months and years,
 * custom-range validation, prev/next stepping and the year chooser.
 *
 * Every function is pure and takes `today` (the viewer's local date key) as an
 * argument, so nothing here reads a clock or the process time zone. Range ends
 * are inclusive date keys.
 *
 * Kinds and what they mean:
 * - `this_month`: the first of the current month through today.
 * - `ytd`: 1 January of the current year through today (the default).
 * - `last_12_months`: today minus 12 calendar months plus one day, through
 *   today.
 * - `month`: one calendar month that has ended. The current month is always
 *   `this_month`, never `month`, so a `month` range never changes when today
 *   moves.
 * - `year`: one calendar year that has ended. The current year is always
 *   `ytd`, for the same reason.
 * - `custom`: any other inclusive range of at least seven days.
 *
 * The view (a month grid or the annual grid) is derived from the kind and
 * nothing else, so a layout change can never change it.
 */
import {
  DateKey,
  addDays,
  addMonthsClamped,
  compareDateKeys,
  dateKeyParts,
  daysInMonth,
  inclusiveDayCount,
  localDateKeyAt,
  parseDateKey,
  toDateKey
} from './localDay'

export type PresetKind = 'this_month' | 'ytd' | 'last_12_months'
export type RangeKind = PresetKind | 'year' | 'month' | 'custom'
/** What the picker draft can hold: a preset, or free-form dates. */
export type DraftKind = PresetKind | 'custom'
export type RangeView = 'month' | 'annual'
export type StepDirection = 'previous' | 'next'

export interface AppliedRange {
  readonly kind: RangeKind
  readonly from: DateKey
  readonly to: DateKey
}

/** The earliest year the overview offers; the product has no data before it. */
export const MIN_YEAR = 1970
export const MIN_DATE_KEY: DateKey = toDateKey(MIN_YEAR, 1, 1)
/** A custom range must span at least this many days, both ends included. */
export const MIN_CUSTOM_RANGE_DAYS = 7

export const rangesEqual = (a: AppliedRange, b: AppliedRange): boolean =>
  a.kind === b.kind && a.from === b.from && a.to === b.to

/** True when the date key lies inside the range, both ends included. */
export const rangeContains = (range: AppliedRange, date: DateKey): boolean =>
  compareDateKeys(date, range.from) >= 0 && compareDateKeys(date, range.to) <= 0

export const viewFor = (range: AppliedRange): RangeView =>
  range.kind === 'this_month' || range.kind === 'month' ? 'month' : 'annual'

const firstOfMonth = (year: number, month1: number) =>
  toDateKey(year, month1, 1)

const lastOfMonth = (year: number, month1: number) =>
  toDateKey(year, month1, daysInMonth(year, month1))

const isSupportedYear = (year: number, today: DateKey) =>
  Number.isInteger(year) && year >= MIN_YEAR && year <= dateKeyParts(today).year

export const presetRange = (kind: PresetKind, today: DateKey): AppliedRange => {
  const { year, month } = dateKeyParts(today)
  switch (kind) {
    case 'this_month':
      return { kind, from: firstOfMonth(year, month), to: today }
    case 'ytd':
      return { kind, from: firstOfMonth(year, 1), to: today }
    case 'last_12_months':
      return {
        kind,
        from: addDays(addMonthsClamped(today, -12), 1),
        to: today
      }
  }
}

/**
 * A calendar year: 1 January through 31 December for a year that has ended,
 * year to date for the current one, `null` for a future year or one before
 * `MIN_YEAR`.
 */
export const yearRange = (
  year: number,
  today: DateKey
): AppliedRange | null => {
  if (!isSupportedYear(year, today)) return null
  if (year === dateKeyParts(today).year) return presetRange('ytd', today)
  return {
    kind: 'year',
    from: firstOfMonth(year, 1),
    to: lastOfMonth(year, 12)
  }
}

/**
 * A calendar month: the whole month once it has ended, the first through today
 * for the current month, `null` for a future month or one before `MIN_YEAR`.
 */
export const monthRange = (
  year: number,
  month1: number,
  today: DateKey
): AppliedRange | null => {
  if (!Number.isInteger(month1) || month1 < 1 || month1 > 12) return null
  if (!isSupportedYear(year, today)) return null
  const from = firstOfMonth(year, month1)
  if (compareDateKeys(from, today) > 0) return null
  const current = dateKeyParts(today)
  if (year === current.year && month1 === current.month) {
    return presetRange('this_month', today)
  }
  return { kind: 'month', from, to: lastOfMonth(year, month1) }
}

/**
 * Names a validated custom range. A range that is exactly a preset, a whole
 * past month or a whole past year takes that kind (so the picker and the
 * heatmap treat it like the shortcut), otherwise it stays `custom`. The caller
 * must already have checked `MIN_DATE_KEY <= from <= to <= today`.
 */
export const normalizeCustom = (
  from: DateKey,
  to: DateKey,
  today: DateKey
): AppliedRange => {
  // `this_month` is tried first: on 20 January, 1-20 January is both it and
  // year to date, and a month is the more specific reading.
  for (const kind of ['this_month', 'ytd', 'last_12_months'] as const) {
    const preset = presetRange(kind, today)
    if (preset.from === from && preset.to === to) return preset
  }
  const start = dateKeyParts(from)
  const end = dateKeyParts(to)
  if (start.year === end.year && start.day === 1) {
    if (start.month === 1 && end.month === 12 && end.day === 31) {
      return { kind: 'year', from, to }
    }
    if (
      start.month === end.month &&
      end.day === daysInMonth(end.year, end.month)
    ) {
      return { kind: 'month', from, to }
    }
  }
  return { kind: 'custom', from, to }
}

/**
 * Re-expresses a range against a new `today`. Presets move with the clock, a
 * month or year that is now current becomes `this_month` or `ytd`, and a range
 * that has fallen into the future (the clock moved back, for example after a
 * time-zone change) is clamped or replaced by year to date.
 */
export const rederiveRange = (
  range: AppliedRange,
  today: DateKey
): AppliedRange => {
  switch (range.kind) {
    case 'this_month':
    case 'ytd':
    case 'last_12_months':
      return presetRange(range.kind, today)
    case 'month': {
      const { year, month } = dateKeyParts(range.from)
      return monthRange(year, month, today) ?? presetRange('ytd', today)
    }
    case 'year':
      return (
        yearRange(dateKeyParts(range.from).year, today) ??
        presetRange('ytd', today)
      )
    case 'custom':
      if (compareDateKeys(range.to, today) <= 0) return range
      if (compareDateKeys(range.from, today) > 0) {
        return presetRange('ytd', today)
      }
      return { kind: 'custom', from: range.from, to: today }
  }
}

/** The inclusive `from`/`to` text a preset puts into the picker's fields. */
export const presetDraftTexts = (kind: PresetKind, today: DateKey) => {
  const range = presetRange(kind, today)
  return { fromText: range.from as string, toText: range.to as string }
}

/**
 * The range one step away: a calendar month in month view, a calendar year in
 * annual view (anchored on the year the range ends in). `null` means the target
 * is entirely in the future, or before `MIN_YEAR`, and the control is disabled.
 */
export const stepTarget = (
  range: AppliedRange,
  direction: StepDirection,
  today: DateKey
): AppliedRange | null => {
  const delta = direction === 'previous' ? -1 : 1
  if (viewFor(range) === 'month') {
    const target = addMonthsClamped(range.from, delta)
    const { year, month } = dateKeyParts(target)
    return monthRange(year, month, today)
  }
  return yearRange(dateKeyParts(range.to).year + delta, today)
}

/**
 * The month that "Month view" opens from an annual range: the month the range
 * ends in, whole if it has ended and up to today if it is the current month.
 */
export const latestMonthIn = (
  range: AppliedRange,
  today: DateKey
): AppliedRange => {
  const { year, month } = dateKeyParts(range.to)
  return monthRange(year, month, today) ?? presetRange('this_month', today)
}

/** One entry per calendar year the range touches, oldest first. */
export const annualYears = (range: AppliedRange): number[] => {
  const first = dateKeyParts(range.from).year
  const last = dateKeyParts(range.to).year
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

/**
 * Years the chooser offers, newest first: from the local year of the actor's
 * earliest activity (never before `MIN_YEAR`) through the current year. With no
 * activity the chooser offers the current year alone.
 */
export const yearsForChooser = (
  earliestActivityMs: number | null,
  timeZone: string,
  today: DateKey
): number[] => {
  const currentYear = dateKeyParts(today).year
  const earliestYear =
    earliestActivityMs === null || !Number.isFinite(earliestActivityMs)
      ? currentYear
      : dateKeyParts(localDateKeyAt(earliestActivityMs, timeZone)).year
  const firstYear = Math.min(Math.max(earliestYear, MIN_YEAR), currentYear)
  return Array.from(
    { length: currentYear - firstYear + 1 },
    (_, index) => currentYear - index
  )
}

export type DraftErrorField = 'from' | 'to' | 'range'

/** One code per rule, so the UI maps each to its own inline message. */
export type DraftErrorCode =
  | 'from_missing'
  | 'from_malformed'
  | 'from_before_minimum'
  | 'to_missing'
  | 'to_malformed'
  | 'to_before_minimum'
  | 'to_after_today'
  | 'range_inverted'
  | 'range_too_short'

export interface DraftError {
  field: DraftErrorField
  code: DraftErrorCode
  /** Default English copy; the UI may replace it. */
  message: string
}

export type DraftValidation =
  { ok: true; range: AppliedRange } | { ok: false; errors: DraftError[] }

export interface RangeDraft {
  fromText: string
  toText: string
  kind: DraftKind
}

export const DRAFT_ERROR_MESSAGES: Record<DraftErrorCode, string> = {
  from_missing: 'Enter a start date',
  from_malformed: 'Enter a valid date',
  from_before_minimum: `Start date can't be before ${MIN_YEAR}`,
  to_missing: 'Enter an end date',
  to_malformed: 'Enter a valid date',
  to_before_minimum: `End date can't be before ${MIN_YEAR}`,
  to_after_today: "End date can't be after today",
  range_inverted: 'Start date must be on or before the end date',
  range_too_short: `Choose at least ${MIN_CUSTOM_RANGE_DAYS} days, or use This month or Year to date`
}

const draftError = (
  field: DraftErrorField,
  code: DraftErrorCode
): DraftError => ({ field, code, message: DRAFT_ERROR_MESSAGES[code] })

type ParsedDate = { date: DateKey } | { error: DraftError }

const parseDraftDate = (text: string, field: 'from' | 'to'): ParsedDate => {
  const trimmed = text.trim()
  if (trimmed === '') return { error: draftError(field, `${field}_missing`) }
  const date = parseDateKey(trimmed)
  if (date === null) return { error: draftError(field, `${field}_malformed`) }
  return { date }
}

/**
 * Checks the picker draft and, when it is valid, names the range to apply.
 *
 * All rules apply to every kind except the seven-day minimum, which is waived
 * only for a draft that is exactly its preset (This month and Year to date are
 * one to six days long at the start of a month or year). A preset whose fields
 * no longer match it, for example after midnight, is judged as a custom range.
 */
export const validateDraft = (
  draft: RangeDraft,
  today: DateKey
): DraftValidation => {
  const from = parseDraftDate(draft.fromText, 'from')
  const to = parseDraftDate(draft.toText, 'to')
  const errors: DraftError[] = []

  if ('error' in from) errors.push(from.error)
  else if (compareDateKeys(from.date, MIN_DATE_KEY) < 0) {
    errors.push(draftError('from', 'from_before_minimum'))
  }

  if ('error' in to) errors.push(to.error)
  else if (compareDateKeys(to.date, MIN_DATE_KEY) < 0) {
    errors.push(draftError('to', 'to_before_minimum'))
  } else if (compareDateKeys(to.date, today) > 0) {
    errors.push(draftError('to', 'to_after_today'))
  }

  if (
    'date' in from &&
    'date' in to &&
    compareDateKeys(from.date, to.date) > 0
  ) {
    errors.push(draftError('range', 'range_inverted'))
  }
  if (errors.length > 0 || !('date' in from) || !('date' in to)) {
    return { ok: false, errors }
  }

  if (draft.kind !== 'custom') {
    const preset = presetRange(draft.kind, today)
    if (preset.from === from.date && preset.to === to.date) {
      return { ok: true, range: preset }
    }
  }
  if (inclusiveDayCount(from.date, to.date) < MIN_CUSTOM_RANGE_DAYS) {
    return { ok: false, errors: [draftError('range', 'range_too_short')] }
  }
  return { ok: true, range: normalizeCustom(from.date, to.date, today) }
}
