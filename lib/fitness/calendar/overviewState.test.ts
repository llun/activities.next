import { DateKey, parseDateKey } from './localDay'
import {
  OverviewAction,
  OverviewMetric,
  OverviewState,
  createOverviewState,
  getDraftValidation,
  getStepTarget,
  getView,
  overviewReducer
} from './overviewState'
import { AppliedRange, RangeKind, presetRange } from './ranges'

const key = (value: string): DateKey => {
  const parsed = parseDateKey(value)
  if (!parsed) throw new Error(`Test fixture is not a date key: ${value}`)
  return parsed
}

const range = (kind: RangeKind, from: string, to: string): AppliedRange => ({
  kind,
  from: key(from),
  to: key(to)
})

const run = (state: OverviewState, ...actions: OverviewAction[]) =>
  actions.reduce(overviewReducer, state)

const TODAY = key('2026-10-04')
const initial = () => createOverviewState(TODAY)

const stateWith = (
  applied: AppliedRange,
  today: DateKey = TODAY
): OverviewState => createOverviewState(today, applied)

const draftCodes = (state: OverviewState) => {
  const validation = getDraftValidation(state)
  return validation && !validation.ok
    ? validation.errors.map((error) => error.code)
    : []
}

describe('createOverviewState', () => {
  it('starts on year to date with nothing selected', () => {
    expect(initial()).toEqual({
      today: TODAY,
      applied: range('ytd', '2026-01-01', '2026-10-04'),
      annualReturn: range('ytd', '2026-01-01', '2026-10-04'),
      selectedDate: null,
      metric: 'count',
      picker: null
    })
    expect(getView(initial())).toBe('annual')
  })

  it('remembers year to date as the annual return for a month start', () => {
    const state = stateWith(range('this_month', '2026-10-01', '2026-10-04'))
    expect(state.annualReturn).toEqual(range('ytd', '2026-01-01', '2026-10-04'))
    expect(getView(state)).toBe('month')
  })

  it('uses an annual start range as its own annual return', () => {
    const applied = range('last_12_months', '2025-10-05', '2026-10-04')
    expect(stateWith(applied).annualReturn).toEqual(applied)
  })
})

describe('opening a month', () => {
  it('opens month view on a month label and keeps year to date to return to', () => {
    const state = run(initial(), { type: 'OPEN_MONTH', year: 2026, month: 3 })
    expect(state.applied).toEqual(range('month', '2026-03-01', '2026-03-31'))
    expect(getView(state)).toBe('month')
    expect(state.annualReturn).toEqual(initial().applied)
  })

  it('ends the current month at today', () => {
    const state = run(initial(), { type: 'OPEN_MONTH', year: 2026, month: 10 })
    expect(state.applied).toEqual(
      range('this_month', '2026-10-01', '2026-10-04')
    )
  })

  it.each([
    ['a future month', 2026, 11],
    ['next year', 2027, 1],
    ['before 1970', 1969, 12],
    ['month 13', 2026, 13]
  ])('ignores %s', (_name, year, month) => {
    const state = initial()
    expect(run(state, { type: 'OPEN_MONTH', year, month })).toBe(state)
  })

  it.each([
    [
      'year to date',
      range('ytd', '2026-01-01', '2026-10-04'),
      range('this_month', '2026-10-01', '2026-10-04')
    ],
    [
      'last 12 months',
      range('last_12_months', '2025-10-05', '2026-10-04'),
      range('this_month', '2026-10-01', '2026-10-04')
    ],
    [
      'a past year',
      range('year', '2025-01-01', '2025-12-31'),
      range('month', '2025-12-01', '2025-12-31')
    ],
    [
      'a custom range',
      range('custom', '2025-03-05', '2025-06-20'),
      range('month', '2025-06-01', '2025-06-30')
    ]
  ])(
    '"Month view" from %s opens the latest month in range',
    (_name, start, expected) => {
      const state = run(stateWith(start), { type: 'OPEN_LATEST_MONTH' })
      expect(state.applied).toEqual(expected)
      expect(getView(state)).toBe('month')
      expect(state.annualReturn).toEqual(start)
    }
  )
})

describe('Back to year', () => {
  it.each([
    ['year to date', range('ytd', '2026-01-01', '2026-10-04')],
    ['last 12 months', range('last_12_months', '2025-10-05', '2026-10-04')],
    ['a past year', range('year', '2024-01-01', '2024-12-31')],
    ['a custom range', range('custom', '2025-03-05', '2026-02-11')]
  ])(
    'restores %s exactly after opening a month and stepping around',
    (_name, start) => {
      const state = run(
        stateWith(start),
        { type: 'OPEN_LATEST_MONTH' },
        { type: 'STEP', direction: 'previous' },
        { type: 'STEP', direction: 'previous' },
        { type: 'STEP', direction: 'next' }
      )
      expect(getView(state)).toBe('month')

      const restored = run(state, { type: 'BACK_TO_YEAR' })
      expect(restored.applied).toEqual(start)
      expect(restored.annualReturn).toEqual(start)
      expect(getView(restored)).toBe('annual')
    }
  )

  it('restores the year that was open, not year to date', () => {
    const state = run(
      initial(),
      { type: 'STEP', direction: 'previous' },
      { type: 'OPEN_MONTH', year: 2025, month: 6 },
      { type: 'BACK_TO_YEAR' }
    )
    expect(state.applied).toEqual(range('year', '2025-01-01', '2025-12-31'))
  })

  it('restores the annual range after a month is applied from the picker', () => {
    const state = run(
      initial(),
      { type: 'OPEN_PICKER' },
      { type: 'CHOOSE_PRESET', preset: 'this_month' },
      { type: 'APPLY_PICKER' },
      { type: 'BACK_TO_YEAR' }
    )
    expect(state.applied).toEqual(initial().applied)
  })

  it('does nothing in annual view', () => {
    const state = initial()
    expect(run(state, { type: 'BACK_TO_YEAR' })).toBe(state)
  })

  it('clears a selection the restored range does not contain', () => {
    const state = run(
      stateWith(range('year', '2025-01-01', '2025-12-31')),
      { type: 'OPEN_MONTH', year: 2025, month: 6 },
      { type: 'SELECT_DAY', date: key('2025-06-10') },
      { type: 'BACK_TO_YEAR' }
    )
    expect(state.selectedDate).toBe('2025-06-10')

    const other = run(
      initial(),
      { type: 'OPEN_MONTH', year: 2026, month: 10 },
      { type: 'SELECT_DAY', date: key('2026-10-02') },
      { type: 'APPLY_YEAR', year: 2025 }
    )
    expect(other.selectedDate).toBeNull()
  })
})

describe('stepping', () => {
  it('steps calendar months in month view, across December and January', () => {
    let state = stateWith(range('month', '2025-12-01', '2025-12-31'))
    state = run(state, { type: 'STEP', direction: 'next' })
    expect(state.applied).toEqual(range('month', '2026-01-01', '2026-01-31'))
    state = run(state, { type: 'STEP', direction: 'previous' })
    expect(state.applied).toEqual(range('month', '2025-12-01', '2025-12-31'))
  })

  it('steps through a leap February', () => {
    let state = stateWith(range('month', '2024-03-01', '2024-03-31'))
    state = run(state, { type: 'STEP', direction: 'previous' })
    expect(state.applied).toEqual(range('month', '2024-02-01', '2024-02-29'))
    state = run(state, { type: 'STEP', direction: 'previous' })
    expect(state.applied).toEqual(range('month', '2024-01-01', '2024-01-31'))
  })

  it('steps calendar years in annual view and the annual return follows', () => {
    const state = run(initial(), { type: 'STEP', direction: 'previous' })
    expect(state.applied).toEqual(range('year', '2025-01-01', '2025-12-31'))
    expect(state.annualReturn).toEqual(state.applied)

    const forward = run(state, { type: 'STEP', direction: 'next' })
    expect(forward.applied).toEqual(range('ytd', '2026-01-01', '2026-10-04'))
  })

  it('moves from the previous month into the current month, ending today', () => {
    const state = run(stateWith(range('month', '2026-09-01', '2026-09-30')), {
      type: 'STEP',
      direction: 'next'
    })
    expect(state.applied).toEqual(
      range('this_month', '2026-10-01', '2026-10-04')
    )
  })

  describe('disabled when the target is entirely in the future', () => {
    it.each([
      ['month view', range('this_month', '2026-10-01', '2026-10-04')],
      ['year to date', range('ytd', '2026-01-01', '2026-10-04')],
      ['last 12 months', range('last_12_months', '2025-10-05', '2026-10-04')]
    ])('next in %s', (_name, applied) => {
      const state = stateWith(applied)
      expect(getStepTarget(state, 'next')).toBeNull()
      expect(run(state, { type: 'STEP', direction: 'next' })).toBe(state)
    })

    it('leaves previous enabled', () => {
      expect(getStepTarget(initial(), 'previous')).toEqual(
        range('year', '2025-01-01', '2025-12-31')
      )
    })

    it('does not step before 1970', () => {
      const state = stateWith(range('month', '1970-01-01', '1970-01-31'))
      expect(getStepTarget(state, 'previous')).toBeNull()
      expect(run(state, { type: 'STEP', direction: 'previous' })).toBe(state)
    })
  })
})

describe('day selection', () => {
  it('selects a day inside the range without changing the range', () => {
    const state = initial()
    const selected = run(state, { type: 'SELECT_DAY', date: key('2026-03-15') })
    expect(selected.selectedDate).toBe('2026-03-15')
    expect(selected.applied).toBe(state.applied)
    expect(selected.annualReturn).toBe(state.annualReturn)
    expect(getView(selected)).toBe('annual')
  })

  it.each([
    ['before the range', '2025-12-31'],
    ['after today', '2026-10-05'],
    ['far in the future', '2030-01-01']
  ])('ignores a day %s', (_name, date) => {
    const state = initial()
    expect(run(state, { type: 'SELECT_DAY', date: key(date) })).toBe(state)
  })

  it('selects a day inside `within` although `applied` does not contain it', () => {
    // After a failed read the grid draws the previous range.
    const state = stateWith(range('year', '2024-01-01', '2024-12-31'))
    const selected = run(state, {
      type: 'SELECT_DAY',
      date: key('2025-06-10'),
      within: range('year', '2025-01-01', '2025-12-31')
    })
    expect(selected.selectedDate).toBe('2025-06-10')
    expect(selected.applied).toBe(state.applied)
    expect(selected.annualReturn).toBe(state.annualReturn)
  })

  it('ignores a day outside `within`, even inside `applied`', () => {
    const state = stateWith(range('year', '2024-01-01', '2024-12-31'))
    expect(
      run(state, {
        type: 'SELECT_DAY',
        date: key('2024-06-10'),
        within: range('year', '2025-01-01', '2025-12-31')
      })
    ).toBe(state)
  })

  it('clears a day picked on `within` when a range that excludes it is applied', () => {
    const state = run(
      stateWith(range('year', '2024-01-01', '2024-12-31')),
      {
        type: 'SELECT_DAY',
        date: key('2025-06-10'),
        within: range('year', '2025-01-01', '2025-12-31')
      },
      { type: 'STEP', direction: 'previous' }
    )
    expect(state.selectedDate).toBeNull()
  })

  it('ignores a value that is not a date key', () => {
    const state = initial()
    expect(
      run(state, { type: 'SELECT_DAY', date: '2026-02-30' as DateKey })
    ).toBe(state)
  })

  it('keeps the same state when the day is already selected', () => {
    const selected = run(initial(), {
      type: 'SELECT_DAY',
      date: key('2026-03-15')
    })
    expect(run(selected, { type: 'SELECT_DAY', date: key('2026-03-15') })).toBe(
      selected
    )
  })

  it('clears with CLEAR_DAY', () => {
    const selected = run(initial(), {
      type: 'SELECT_DAY',
      date: key('2026-03-15')
    })
    expect(run(selected, { type: 'CLEAR_DAY' }).selectedDate).toBeNull()
    expect(run(initial(), { type: 'CLEAR_DAY' }).selectedDate).toBeNull()
  })

  describe('is cleared when the range no longer contains it', () => {
    const selected = (date: string) =>
      run(initial(), { type: 'SELECT_DAY', date: key(date) })

    it.each([
      [
        'a month that excludes it',
        { type: 'OPEN_MONTH', year: 2026, month: 3 }
      ],
      ['a year that excludes it', { type: 'APPLY_YEAR', year: 2025 }],
      ['a previous step', { type: 'STEP', direction: 'previous' }],
      [
        'a custom range that excludes it',
        {
          type: 'APPLY_RANGE',
          range: range('custom', '2026-06-01', '2026-06-30')
        }
      ]
    ] as Array<[string, OverviewAction]>)('by %s', (_name, action) => {
      expect(run(selected('2026-09-15'), action).selectedDate).toBeNull()
    })

    it.each([
      [
        'a month that includes it',
        { type: 'OPEN_MONTH', year: 2026, month: 9 }
      ],
      [
        'a custom range that includes it',
        {
          type: 'APPLY_RANGE',
          range: range('custom', '2026-09-01', '2026-09-30')
        }
      ],
      [
        'last 12 months',
        {
          type: 'APPLY_RANGE',
          range: range('last_12_months', '2025-10-05', '2026-10-04')
        }
      ]
    ] as Array<[string, OverviewAction]>)('and kept by %s', (_name, action) => {
      expect(run(selected('2026-09-15'), action).selectedDate).toBe(
        '2026-09-15'
      )
    })

    it('by stepping to another month', () => {
      const state = run(
        stateWith(range('month', '2026-09-01', '2026-09-30')),
        { type: 'SELECT_DAY', date: key('2026-09-15') },
        { type: 'STEP', direction: 'next' }
      )
      expect(state.selectedDate).toBeNull()
    })

    it('by applying a draft that excludes it', () => {
      const state = run(
        selected('2026-09-15'),
        { type: 'OPEN_PICKER' },
        { type: 'EDIT_DRAFT', field: 'from', text: '2026-01-01' },
        { type: 'EDIT_DRAFT', field: 'to', text: '2026-02-20' },
        { type: 'APPLY_PICKER' }
      )
      expect(state.applied.to).toBe('2026-02-20')
      expect(state.selectedDate).toBeNull()
    })
  })
})

describe('APPLY_RANGE and APPLY_YEAR', () => {
  it('applies a valid custom range and treats it as the annual return', () => {
    const custom = range('custom', '2025-03-05', '2026-02-11')
    const state = run(initial(), { type: 'APPLY_RANGE', range: custom })
    expect(state.applied).toEqual(custom)
    expect(state.annualReturn).toEqual(custom)
  })

  it.each([
    ['ends after today', range('custom', '2026-09-20', '2026-10-05')],
    ['starts after it ends', range('custom', '2026-09-20', '2026-09-10')],
    ['starts before 1970', range('custom', '1969-12-01', '1970-02-01')]
  ])('ignores a range that %s', (_name, applied) => {
    const state = initial()
    expect(run(state, { type: 'APPLY_RANGE', range: applied })).toBe(state)
  })

  it.each([
    [2025, range('year', '2025-01-01', '2025-12-31')],
    [2024, range('year', '2024-01-01', '2024-12-31')],
    [2026, range('ytd', '2026-01-01', '2026-10-04')]
  ])('applies year %s', (year, expected) => {
    const state = run(initial(), { type: 'APPLY_YEAR', year })
    expect(state.applied).toEqual(expected)
    expect(getView(state)).toBe('annual')
  })

  it.each([2027, 1969])('ignores year %s', (year) => {
    const state = initial()
    expect(run(state, { type: 'APPLY_YEAR', year })).toBe(state)
  })

  it('closes an open picker without applying its draft', () => {
    const state = run(
      initial(),
      { type: 'OPEN_PICKER' },
      { type: 'EDIT_DRAFT', field: 'from', text: '2026-02-01' },
      { type: 'APPLY_YEAR', year: 2025 }
    )
    expect(state.picker).toBeNull()
    expect(state.applied).toEqual(range('year', '2025-01-01', '2025-12-31'))
  })
})

describe('metric', () => {
  it('changes the metric without touching the range or selection', () => {
    const selected = run(initial(), {
      type: 'SELECT_DAY',
      date: key('2026-03-15')
    })
    const state = run(selected, { type: 'SET_METRIC', metric: 'distance' })
    expect(state.metric).toBe('distance')
    expect(state.applied).toBe(selected.applied)
    expect(state.selectedDate).toBe('2026-03-15')
  })

  it('ignores the current and unknown metrics', () => {
    const state = initial()
    expect(run(state, { type: 'SET_METRIC', metric: 'count' })).toBe(state)
    expect(
      run(state, { type: 'SET_METRIC', metric: 'speed' as OverviewMetric })
    ).toBe(state)
  })
})

describe('SET_TODAY', () => {
  it.each([
    // Month end, then the first of the next month.
    ['2026-10-31', '2026-11-01'],
    // Year end.
    ['2026-12-31', '2027-01-01'],
    // Leap day on both sides.
    ['2024-02-28', '2024-02-29'],
    ['2024-02-29', '2024-03-01']
  ])(
    're-derives every preset when midnight passes from %s to %s',
    (before, after) => {
      for (const kind of ['this_month', 'ytd', 'last_12_months'] as const) {
        const state = run(
          stateWith(presetRange(kind, key(before)), key(before)),
          {
            type: 'SET_TODAY',
            today: key(after)
          }
        )
        expect(state.today).toBe(after)
        expect(state.applied).toEqual(presetRange(kind, key(after)))
      }
    }
  )

  it('rolls this month over at the end of the month', () => {
    const state = run(
      stateWith(
        presetRange('this_month', key('2026-10-31')),
        key('2026-10-31')
      ),
      { type: 'SET_TODAY', today: key('2026-11-01') }
    )
    expect(state.applied).toEqual(
      range('this_month', '2026-11-01', '2026-11-01')
    )
  })

  it('rolls year to date over at New Year', () => {
    const state = run(
      stateWith(presetRange('ytd', key('2026-12-31')), key('2026-12-31')),
      { type: 'SET_TODAY', today: key('2027-01-01') }
    )
    expect(state.applied).toEqual(range('ytd', '2027-01-01', '2027-01-01'))
    expect(state.annualReturn).toEqual(state.applied)
  })

  it('shifts last 12 months by a day', () => {
    const state = run(
      stateWith(
        presetRange('last_12_months', key('2024-02-28')),
        key('2024-02-28')
      ),
      { type: 'SET_TODAY', today: key('2024-02-29') }
    )
    expect(state.applied).toEqual(
      range('last_12_months', '2023-03-01', '2024-02-29')
    )
  })

  it.each([
    ['a past month', range('month', '2026-09-01', '2026-09-30')],
    ['a past year', range('year', '2025-01-01', '2025-12-31')],
    ['a custom range', range('custom', '2026-03-02', '2026-03-20')]
  ])('leaves %s alone', (_name, applied) => {
    const state = run(stateWith(applied, key('2026-10-31')), {
      type: 'SET_TODAY',
      today: key('2026-11-01')
    })
    expect(state.applied).toEqual(applied)
  })

  it('re-derives the annual return while month view is open', () => {
    const state = run(
      stateWith(
        range('this_month', '2026-10-01', '2026-10-31'),
        key('2026-10-31')
      ),
      { type: 'SET_TODAY', today: key('2026-11-01') }
    )
    expect(getView(state)).toBe('month')
    expect(state.applied).toEqual(
      range('this_month', '2026-11-01', '2026-11-01')
    )
    expect(state.annualReturn).toEqual(range('ytd', '2026-01-01', '2026-11-01'))

    expect(run(state, { type: 'BACK_TO_YEAR' }).applied).toEqual(
      range('ytd', '2026-01-01', '2026-11-01')
    )
  })

  it('keeps a still-annual return, such as a past year, when midnight passes in month view', () => {
    const inMonth = run(stateWith(range('year', '2024-01-01', '2024-12-31')), {
      type: 'OPEN_MONTH',
      year: 2024,
      month: 3
    })
    expect(getView(inMonth)).toBe('month')
    expect(inMonth.annualReturn).toEqual(
      range('year', '2024-01-01', '2024-12-31')
    )

    const rolled = run(inMonth, { type: 'SET_TODAY', today: key('2026-10-05') })
    expect(rolled.annualReturn).toEqual(
      range('year', '2024-01-01', '2024-12-31')
    )
    expect(run(rolled, { type: 'BACK_TO_YEAR' }).applied).toEqual(
      range('year', '2024-01-01', '2024-12-31')
    )
  })

  it('clears a selection that the re-derived range drops', () => {
    const monthStart = stateWith(
      range('this_month', '2026-10-01', '2026-10-31'),
      key('2026-10-31')
    )
    const dropped = run(
      monthStart,
      { type: 'SELECT_DAY', date: key('2026-10-20') },
      { type: 'SET_TODAY', today: key('2026-11-01') }
    )
    expect(dropped.selectedDate).toBeNull()

    const ytd = stateWith(
      range('ytd', '2026-01-01', '2026-10-31'),
      key('2026-10-31')
    )
    const kept = run(
      ytd,
      { type: 'SELECT_DAY', date: key('2026-10-20') },
      { type: 'SET_TODAY', today: key('2026-11-01') }
    )
    expect(kept.selectedDate).toBe('2026-10-20')
  })

  it('follows a clock that moved back', () => {
    const state = run(stateWith(range('custom', '2026-09-20', '2026-10-04')), {
      type: 'SET_TODAY',
      today: key('2026-09-30')
    })
    expect(state.applied).toEqual(range('custom', '2026-09-20', '2026-09-30'))
  })

  it('ignores the same day and a malformed one', () => {
    const state = initial()
    expect(run(state, { type: 'SET_TODAY', today: TODAY })).toBe(state)
    expect(
      run(state, { type: 'SET_TODAY', today: '2026-13-01' as DateKey })
    ).toBe(state)
  })

  it('keeps a preset draft on the new day but not a custom draft', () => {
    const preset = run(
      stateWith(
        presetRange('this_month', key('2026-10-31')),
        key('2026-10-31')
      ),
      { type: 'OPEN_PICKER' },
      { type: 'SET_TODAY', today: key('2026-11-01') }
    )
    expect(preset.picker).toEqual({
      kind: 'this_month',
      fromText: '2026-11-01',
      toText: '2026-11-01'
    })

    const custom = run(
      initial(),
      { type: 'OPEN_PICKER' },
      { type: 'EDIT_DRAFT', field: 'from', text: '2026-0' },
      { type: 'SET_TODAY', today: key('2026-10-05') }
    )
    expect(custom.picker?.fromText).toBe('2026-0')
  })
})

describe('picker draft', () => {
  describe('opening', () => {
    it.each([
      ['year to date', range('ytd', '2026-01-01', '2026-10-04'), 'ytd'],
      [
        'this month',
        range('this_month', '2026-10-01', '2026-10-04'),
        'this_month'
      ],
      [
        'last 12 months',
        range('last_12_months', '2025-10-05', '2026-10-04'),
        'last_12_months'
      ],
      ['a month', range('month', '2026-09-01', '2026-09-30'), 'custom'],
      ['a year', range('year', '2025-01-01', '2025-12-31'), 'custom'],
      ['a custom range', range('custom', '2025-03-05', '2026-02-11'), 'custom']
    ])('starts from the applied %s', (_name, applied, kind) => {
      const closed = stateWith(applied)
      const state = run(closed, { type: 'OPEN_PICKER' })
      expect(state.picker).toEqual({
        kind,
        fromText: applied.from,
        toText: applied.to
      })
      expect(state.applied).toBe(closed.applied)
      expect(getDraftValidation(state)?.ok).toBe(true)
    })

    it('keeps the draft when opened again, as when the presentation switches', () => {
      const edited = run(
        initial(),
        { type: 'OPEN_PICKER' },
        { type: 'EDIT_DRAFT', field: 'from', text: '2026-02-01' }
      )
      expect(run(edited, { type: 'OPEN_PICKER' })).toBe(edited)
    })
  })

  describe('editing', () => {
    it('changes only the draft until Apply', () => {
      const open = run(initial(), { type: 'OPEN_PICKER' })
      const edited = run(
        open,
        { type: 'EDIT_DRAFT', field: 'from', text: '2026-02-01' },
        { type: 'EDIT_DRAFT', field: 'to', text: '2026-02-20' }
      )
      expect(edited.picker).toEqual({
        kind: 'custom',
        fromText: '2026-02-01',
        toText: '2026-02-20'
      })
      expect(edited.applied).toBe(open.applied)
      expect(edited.annualReturn).toBe(open.annualReturn)
    })

    it('fills both fields from a preset and does not apply it', () => {
      const state = run(
        stateWith(range('custom', '2025-03-05', '2026-02-11')),
        { type: 'OPEN_PICKER' },
        { type: 'CHOOSE_PRESET', preset: 'last_12_months' }
      )
      expect(state.picker).toEqual({
        kind: 'last_12_months',
        fromText: '2025-10-05',
        toText: '2026-10-04'
      })
      expect(state.applied).toEqual(range('custom', '2025-03-05', '2026-02-11'))
    })

    it('turns a preset draft into a custom one when a field is edited', () => {
      const state = run(
        initial(),
        { type: 'OPEN_PICKER' },
        { type: 'EDIT_DRAFT', field: 'to', text: '2026-09-30' }
      )
      expect(state.picker?.kind).toBe('custom')
    })
  })

  describe('Cancel and Escape', () => {
    it('discards the draft and leaves the range alone', () => {
      const edited = run(
        initial(),
        { type: 'OPEN_PICKER' },
        { type: 'EDIT_DRAFT', field: 'from', text: '2026-02-01' }
      )
      const cancelled = run(edited, { type: 'CANCEL_PICKER' })
      expect(cancelled.picker).toBeNull()
      expect(cancelled.applied).toBe(edited.applied)
    })

    it('starts the next opening from the applied range again', () => {
      const state = run(
        initial(),
        { type: 'OPEN_PICKER' },
        { type: 'EDIT_DRAFT', field: 'from', text: '2026-02-01' },
        { type: 'CANCEL_PICKER' },
        { type: 'OPEN_PICKER' }
      )
      expect(state.picker).toEqual({
        kind: 'ytd',
        fromText: '2026-01-01',
        toText: '2026-10-04'
      })
    })
  })

  describe('Apply', () => {
    it('commits a valid draft and closes the picker', () => {
      const state = run(
        initial(),
        { type: 'OPEN_PICKER' },
        { type: 'EDIT_DRAFT', field: 'from', text: '2026-02-01' },
        { type: 'EDIT_DRAFT', field: 'to', text: '2026-02-20' },
        { type: 'APPLY_PICKER' }
      )
      expect(state.applied).toEqual(range('custom', '2026-02-01', '2026-02-20'))
      expect(state.annualReturn).toEqual(state.applied)
      expect(state.picker).toBeNull()
    })

    it('opens month view when the draft is a whole month', () => {
      const state = run(
        initial(),
        { type: 'OPEN_PICKER' },
        { type: 'EDIT_DRAFT', field: 'from', text: '2026-09-01' },
        { type: 'EDIT_DRAFT', field: 'to', text: '2026-09-30' },
        { type: 'APPLY_PICKER' }
      )
      expect(state.applied).toEqual(range('month', '2026-09-01', '2026-09-30'))
      expect(getView(state)).toBe('month')
      expect(state.annualReturn).toEqual(initial().applied)
    })

    it.each([
      ['this_month', 'this_month'],
      ['last_12_months', 'last_12_months'],
      ['ytd', 'ytd']
    ] as const)('applies the %s preset', (preset, kind) => {
      const state = run(
        stateWith(range('custom', '2025-03-05', '2026-02-11')),
        { type: 'OPEN_PICKER' },
        { type: 'CHOOSE_PRESET', preset },
        { type: 'APPLY_PICKER' }
      )
      expect(state.applied).toEqual(presetRange(kind, TODAY))
    })

    it.each([
      ['2026-01-02', 'this_month'],
      ['2026-01-02', 'ytd'],
      ['2026-10-03', 'this_month']
    ] as const)(
      'applies %s with the short %s preset on the first days of the period',
      (todayText, preset) => {
        const today = key(todayText)
        const state = run(
          stateWith(presetRange('last_12_months', today), today),
          { type: 'OPEN_PICKER' },
          { type: 'CHOOSE_PRESET', preset },
          { type: 'APPLY_PICKER' }
        )
        expect(state.applied).toEqual(presetRange(preset, today))
        expect(state.picker).toBeNull()
      }
    )

    it('does nothing for an invalid draft and keeps the picker open', () => {
      const invalid = run(
        initial(),
        { type: 'OPEN_PICKER' },
        { type: 'EDIT_DRAFT', field: 'to', text: '2026-01-03' }
      )
      expect(getDraftValidation(invalid)?.ok).toBe(false)
      expect(draftCodes(invalid)).toEqual(['range_too_short'])
      expect(run(invalid, { type: 'APPLY_PICKER' })).toBe(invalid)
    })

    it('can be applied once the draft is corrected', () => {
      const state = run(
        initial(),
        { type: 'OPEN_PICKER' },
        { type: 'EDIT_DRAFT', field: 'to', text: '2026-01-03' },
        { type: 'APPLY_PICKER' },
        { type: 'EDIT_DRAFT', field: 'to', text: '2026-01-30' },
        { type: 'APPLY_PICKER' }
      )
      expect(state.applied).toEqual(range('custom', '2026-01-01', '2026-01-30'))
    })
  })

  describe('validity', () => {
    it.each([
      ['a missing start', 'from', '', ['from_missing']],
      ['a malformed start', 'from', '2026-02-30', ['from_malformed']],
      ['a missing end', 'to', '', ['to_missing']],
      ['a malformed end', 'to', 'soon', ['to_malformed']],
      ['an end before the start', 'to', '2025-12-31', ['range_inverted']],
      ['an end after today', 'to', '2026-10-05', ['to_after_today']],
      ['a start before 1970', 'from', '1969-12-31', ['from_before_minimum']]
    ] as const)('flags %s', (_name, field, text, codes) => {
      const state = run(
        initial(),
        { type: 'OPEN_PICKER' },
        { type: 'EDIT_DRAFT', field, text }
      )
      expect(getDraftValidation(state)?.ok).toBe(false)
      expect(draftCodes(state)).toEqual(codes)
    })

    it('has no validation while the picker is closed', () => {
      expect(getDraftValidation(initial())).toBeNull()
    })
  })

  it('ignores draft actions while the picker is closed', () => {
    const state = initial()
    expect(run(state, { type: 'CHOOSE_PRESET', preset: 'ytd' })).toBe(state)
    expect(
      run(state, { type: 'EDIT_DRAFT', field: 'from', text: '2026-02-01' })
    ).toBe(state)
    expect(run(state, { type: 'CANCEL_PICKER' })).toBe(state)
    expect(run(state, { type: 'APPLY_PICKER' })).toBe(state)
  })
})
