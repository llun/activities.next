/**
 * State of the fitness overview: the applied range, the selected day, the
 * heatmap metric and the range picker's draft, as one pure reducer.
 *
 * Invariants the reducer keeps:
 * - The view (month or annual) is derived from `applied.kind`; no action sets
 *   it, so resizing can never change it.
 * - `annualReturn` is the most recent applied range that was in annual view
 *   (year to date at the start). "Back to year" restores it exactly.
 * - `selectedDate` is always inside `applied`. Selecting a day never changes
 *   the range, and a range change clears a selection it no longer contains.
 * - The picker draft changes nothing but itself until `APPLY_PICKER`, and
 *   `APPLY_PICKER` commits only a valid draft. Cancel and Escape discard.
 *
 * An action that cannot apply (a future month, an out-of-range day, an invalid
 * draft) returns the same state object, so React skips the render.
 */
import { DateKey, compareDateKeys, parseDateKey } from './localDay'
import {
  AppliedRange,
  DraftKind,
  DraftValidation,
  MIN_DATE_KEY,
  PresetKind,
  RangeView,
  StepDirection,
  latestMonthIn,
  monthRange,
  presetDraftTexts,
  presetRange,
  rangeContains,
  rederiveRange,
  stepTarget,
  validateDraft,
  viewFor,
  yearRange
} from './ranges'

export type OverviewMetric = 'count' | 'distance' | 'duration'

export const OVERVIEW_METRICS: readonly OverviewMetric[] = [
  'count',
  'distance',
  'duration'
]

/** The picker's uncommitted edit. */
export interface PickerDraft {
  kind: DraftKind
  fromText: string
  toText: string
}

export interface OverviewState {
  /** The viewer's local "today". */
  today: DateKey
  applied: AppliedRange
  annualReturn: AppliedRange
  selectedDate: DateKey | null
  metric: OverviewMetric
  /** `null` while the picker is closed. */
  picker: PickerDraft | null
}

export type OverviewAction =
  /** Commits a range chosen outside the picker's draft. */
  | { type: 'APPLY_RANGE'; range: AppliedRange }
  /** The year chooser: a calendar year, or year to date for the current one. */
  | { type: 'APPLY_YEAR'; year: number }
  /** A month label: opens month view on that month. */
  | { type: 'OPEN_MONTH'; year: number; month: number }
  /** "Month view": opens the latest month in the applied range. */
  | { type: 'OPEN_LATEST_MONTH' }
  | { type: 'STEP'; direction: StepDirection }
  | { type: 'BACK_TO_YEAR' }
  | { type: 'SELECT_DAY'; date: DateKey }
  | { type: 'CLEAR_DAY' }
  | { type: 'SET_METRIC'; metric: OverviewMetric }
  /** The viewer's local date changed, for example at midnight. */
  | { type: 'SET_TODAY'; today: DateKey }
  | { type: 'OPEN_PICKER' }
  | { type: 'CHOOSE_PRESET'; preset: PresetKind }
  | { type: 'EDIT_DRAFT'; field: 'from' | 'to'; text: string }
  /** Cancel, Escape or an outside click: the draft is discarded. */
  | { type: 'CANCEL_PICKER' }
  | { type: 'APPLY_PICKER' }

export const createOverviewState = (
  today: DateKey,
  applied: AppliedRange = presetRange('ytd', today)
): OverviewState => ({
  today,
  applied,
  annualReturn:
    viewFor(applied) === 'annual' ? applied : presetRange('ytd', today),
  selectedDate: null,
  metric: 'count',
  picker: null
})

export const getView = (state: OverviewState): RangeView =>
  viewFor(state.applied)

/** The target of a previous/next step, or `null` when the arrow is disabled. */
export const getStepTarget = (
  state: OverviewState,
  direction: StepDirection
): AppliedRange | null => stepTarget(state.applied, direction, state.today)

export const getDraftValidation = (
  state: OverviewState
): DraftValidation | null =>
  state.picker === null ? null : validateDraft(state.picker, state.today)

/** Whether Apply is enabled. */
export const canApplyDraft = (state: OverviewState): boolean =>
  getDraftValidation(state)?.ok === true

const draftFromRange = (range: AppliedRange): PickerDraft => ({
  kind:
    range.kind === 'this_month' ||
    range.kind === 'ytd' ||
    range.kind === 'last_12_months'
      ? range.kind
      : 'custom',
  fromText: range.from,
  toText: range.to
})

const isApplicable = (range: AppliedRange, today: DateKey) =>
  compareDateKeys(range.from, MIN_DATE_KEY) >= 0 &&
  compareDateKeys(range.from, range.to) <= 0 &&
  compareDateKeys(range.to, today) <= 0

/** Makes `range` the applied range, keeping the derived fields consistent. */
const commit = (state: OverviewState, range: AppliedRange): OverviewState => ({
  ...state,
  applied: range,
  annualReturn: viewFor(range) === 'annual' ? range : state.annualReturn,
  selectedDate:
    state.selectedDate !== null && rangeContains(range, state.selectedDate)
      ? state.selectedDate
      : null
})

const commitIfPresent = (
  state: OverviewState,
  range: AppliedRange | null
): OverviewState => (range === null ? state : commit(state, range))

const setToday = (state: OverviewState, today: DateKey): OverviewState => {
  if (today === state.today) return state
  const applied = rederiveRange(state.applied, today)
  const rederivedReturn = rederiveRange(state.annualReturn, today)
  const annualReturn =
    viewFor(applied) === 'annual'
      ? applied
      : viewFor(rederivedReturn) === 'annual'
        ? rederivedReturn
        : presetRange('ytd', today)
  // A preset draft follows the clock; a custom draft is the user's own text.
  const picker =
    state.picker !== null && state.picker.kind !== 'custom'
      ? { ...state.picker, ...presetDraftTexts(state.picker.kind, today) }
      : state.picker
  return {
    ...state,
    today,
    applied,
    annualReturn,
    picker,
    selectedDate:
      state.selectedDate !== null && rangeContains(applied, state.selectedDate)
        ? state.selectedDate
        : null
  }
}

export const overviewReducer = (
  state: OverviewState,
  action: OverviewAction
): OverviewState => {
  switch (action.type) {
    case 'APPLY_RANGE':
      return isApplicable(action.range, state.today)
        ? commit(state, action.range)
        : state

    case 'APPLY_YEAR': {
      const range = yearRange(action.year, state.today)
      return range === null ? state : { ...commit(state, range), picker: null }
    }

    case 'OPEN_MONTH':
      return commitIfPresent(
        state,
        monthRange(action.year, action.month, state.today)
      )

    case 'OPEN_LATEST_MONTH':
      return commit(state, latestMonthIn(state.applied, state.today))

    case 'STEP':
      return commitIfPresent(state, getStepTarget(state, action.direction))

    case 'BACK_TO_YEAR':
      return getView(state) === 'annual'
        ? state
        : commit(state, state.annualReturn)

    case 'SELECT_DAY':
      if (
        parseDateKey(action.date) === null ||
        !rangeContains(state.applied, action.date) ||
        state.selectedDate === action.date
      ) {
        return state
      }
      return { ...state, selectedDate: action.date }

    case 'CLEAR_DAY':
      return state.selectedDate === null
        ? state
        : { ...state, selectedDate: null }

    case 'SET_METRIC':
      return !OVERVIEW_METRICS.includes(action.metric) ||
        state.metric === action.metric
        ? state
        : { ...state, metric: action.metric }

    case 'SET_TODAY':
      return parseDateKey(action.today) === null
        ? state
        : setToday(state, action.today)

    case 'OPEN_PICKER':
      // Reopening keeps the draft: switching between the popover and the
      // sheet re-renders the picker without discarding what was typed.
      return state.picker !== null
        ? state
        : { ...state, picker: draftFromRange(state.applied) }

    case 'CHOOSE_PRESET':
      return state.picker === null
        ? state
        : {
            ...state,
            picker: {
              kind: action.preset,
              ...presetDraftTexts(action.preset, state.today)
            }
          }

    case 'EDIT_DRAFT':
      return state.picker === null
        ? state
        : {
            ...state,
            picker: {
              ...state.picker,
              kind: 'custom',
              ...(action.field === 'from'
                ? { fromText: action.text }
                : { toText: action.text })
            }
          }

    case 'CANCEL_PICKER':
      return state.picker === null ? state : { ...state, picker: null }

    case 'APPLY_PICKER': {
      const validation = getDraftValidation(state)
      return validation?.ok
        ? { ...commit(state, validation.range), picker: null }
        : state
    }
  }
}
