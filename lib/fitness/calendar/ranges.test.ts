import { DateKey, inclusiveDayCount, parseDateKey } from './localDay'
import {
  AppliedRange,
  DRAFT_ERROR_MESSAGES,
  DraftErrorCode,
  DraftKind,
  PresetKind,
  RangeKind,
  latestMonthIn,
  monthRange,
  normalizeCustom,
  presetDraftTexts,
  presetRange,
  rangeContains,
  rangesEqual,
  rederiveRange,
  stepTarget,
  validateDraft,
  viewFor,
  yearRange,
  yearsForChooser
} from './ranges'

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

const TODAY = key('2026-10-04')

describe('presetRange', () => {
  it.each([
    // today, this month, year to date, last 12 months
    ['2026-10-04', '2026-10-01', '2026-01-01', '2025-10-05'],
    // Leap day: 12 months back clamps to 28 Feb 2023, plus one day.
    ['2024-02-29', '2024-02-01', '2024-01-01', '2023-03-01'],
    // 12 months back lands on the leap day 29 Feb 2024 once +1 day is added.
    ['2025-02-28', '2025-02-01', '2025-01-01', '2024-02-29'],
    ['2026-03-31', '2026-03-01', '2026-01-01', '2025-04-01'],
    ['2024-03-01', '2024-03-01', '2024-01-01', '2023-03-02'],
    ['2028-02-29', '2028-02-01', '2028-01-01', '2027-03-01'],
    ['2026-01-01', '2026-01-01', '2026-01-01', '2025-01-02'],
    ['2026-12-31', '2026-12-01', '2026-01-01', '2026-01-01']
  ])(
    'on %s gives this month from %s, YTD from %s, last 12 months from %s',
    (today, thisMonthFrom, ytdFrom, last12From) => {
      expect(presetRange('this_month', key(today))).toEqual(
        range('this_month', thisMonthFrom, today)
      )
      expect(presetRange('ytd', key(today))).toEqual(
        range('ytd', ytdFrom, today)
      )
      expect(presetRange('last_12_months', key(today))).toEqual(
        range('last_12_months', last12From, today)
      )
    }
  )

  it.each([
    ['2026-10-04', 365],
    ['2024-02-29', 366],
    ['2025-02-28', 366],
    ['2026-03-31', 365]
  ])('last 12 months ending %s spans %d days', (today, days) => {
    const preset = presetRange('last_12_months', key(today))
    expect(inclusiveDayCount(preset.from, preset.to)).toBe(days)
  })
})

describe('yearRange', () => {
  it.each([
    [2025, range('year', '2025-01-01', '2025-12-31')],
    [2024, range('year', '2024-01-01', '2024-12-31')],
    [1970, range('year', '1970-01-01', '1970-12-31')],
    // The current year is year to date, not a full year.
    [2026, range('ytd', '2026-01-01', '2026-10-04')],
    [2027, null],
    [1969, null],
    [2025.5, null],
    [Number.NaN, null]
  ])('year %s', (year, expected) => {
    expect(yearRange(year, TODAY)).toEqual(expected)
  })
})

describe('monthRange', () => {
  it.each([
    [2026, 9, range('month', '2026-09-01', '2026-09-30')],
    [2026, 2, range('month', '2026-02-01', '2026-02-28')],
    [2024, 2, range('month', '2024-02-01', '2024-02-29')],
    [2025, 12, range('month', '2025-12-01', '2025-12-31')],
    [1970, 1, range('month', '1970-01-01', '1970-01-31')],
    // The current month ends at today.
    [2026, 10, range('this_month', '2026-10-01', '2026-10-04')],
    // A month that has not started.
    [2026, 11, null],
    [2027, 1, null],
    [1969, 12, null],
    [2026, 0, null],
    [2026, 13, null],
    [2026, 1.5, null]
  ])('%s-%s', (year, month, expected) => {
    expect(monthRange(year, month, TODAY)).toEqual(expected)
  })

  it('treats the first day of a month as already started', () => {
    expect(monthRange(2026, 10, key('2026-10-01'))).toEqual(
      range('this_month', '2026-10-01', '2026-10-01')
    )
  })
})

describe('viewFor', () => {
  it.each([
    ['this_month', 'month'],
    ['month', 'month'],
    ['ytd', 'annual'],
    ['last_12_months', 'annual'],
    ['year', 'annual'],
    ['custom', 'annual']
  ] as const)('%s opens the %s view', (kind, view) => {
    expect(viewFor(range(kind, '2026-01-01', '2026-01-31'))).toBe(view)
  })
})

describe('rangeContains and rangesEqual', () => {
  const week = range('custom', '2026-09-01', '2026-09-07')

  it.each([
    ['2026-08-31', false],
    ['2026-09-01', true],
    ['2026-09-04', true],
    ['2026-09-07', true],
    ['2026-09-08', false]
  ])('contains %s: %s', (date, expected) => {
    expect(rangeContains(week, key(date))).toBe(expected)
  })

  it('compares kind, start and end', () => {
    expect(rangesEqual(week, { ...week })).toBe(true)
    expect(rangesEqual(week, { ...week, kind: 'month' })).toBe(false)
    expect(rangesEqual(week, { ...week, to: key('2026-09-08') })).toBe(false)
  })
})

describe('normalizeCustom', () => {
  it.each([
    ['2026-10-01', '2026-10-04', 'this_month'],
    ['2026-01-01', '2026-10-04', 'ytd'],
    ['2025-10-05', '2026-10-04', 'last_12_months'],
    ['2026-09-01', '2026-09-30', 'month'],
    ['2024-02-01', '2024-02-29', 'month'],
    ['2025-02-01', '2025-02-28', 'month'],
    ['2025-01-01', '2025-12-31', 'year'],
    ['2024-01-01', '2024-12-31', 'year'],
    // Anything else stays custom.
    ['2026-09-01', '2026-09-29', 'custom'],
    ['2026-09-02', '2026-09-30', 'custom'],
    ['2025-02-01', '2025-03-31', 'custom'],
    ['2024-01-01', '2024-12-30', 'custom'],
    ['2025-01-01', '2026-01-01', 'custom'],
    ['2025-12-01', '2026-01-31', 'custom'],
    ['2024-03-01', '2025-03-31', 'custom'],
    ['2024-01-01', '2025-12-31', 'custom']
  ])('%s to %s is %s', (from, to, kind) => {
    expect(normalizeCustom(key(from), key(to), TODAY)).toEqual(
      range(kind as RangeKind, from, to)
    )
  })

  it('reads 1 to 20 January on 20 January as this month, not year to date', () => {
    expect(
      normalizeCustom(key('2026-01-01'), key('2026-01-20'), key('2026-01-20'))
        .kind
    ).toBe('this_month')
  })
})

describe('stepTarget', () => {
  it.each([
    // Month view steps by calendar month.
    [
      range('month', '2026-09-01', '2026-09-30'),
      'previous',
      range('month', '2026-08-01', '2026-08-31')
    ],
    [
      range('month', '2026-09-01', '2026-09-30'),
      'next',
      range('this_month', '2026-10-01', '2026-10-04')
    ],
    [
      range('this_month', '2026-10-01', '2026-10-04'),
      'previous',
      range('month', '2026-09-01', '2026-09-30')
    ],
    // January to December and back.
    [
      range('month', '2025-12-01', '2025-12-31'),
      'next',
      range('month', '2026-01-01', '2026-01-31')
    ],
    [
      range('month', '2026-01-01', '2026-01-31'),
      'previous',
      range('month', '2025-12-01', '2025-12-31')
    ],
    // Leap year February, in both directions.
    [
      range('month', '2024-01-01', '2024-01-31'),
      'next',
      range('month', '2024-02-01', '2024-02-29')
    ],
    [
      range('month', '2024-03-01', '2024-03-31'),
      'previous',
      range('month', '2024-02-01', '2024-02-29')
    ],
    [
      range('month', '2025-03-01', '2025-03-31'),
      'previous',
      range('month', '2025-02-01', '2025-02-28')
    ],
    [
      range('month', '1970-02-01', '1970-02-28'),
      'previous',
      range('month', '1970-01-01', '1970-01-31')
    ],
    // Annual view steps by calendar year, anchored on the year the range ends.
    [
      range('ytd', '2026-01-01', '2026-10-04'),
      'previous',
      range('year', '2025-01-01', '2025-12-31')
    ],
    [
      range('year', '2025-01-01', '2025-12-31'),
      'next',
      range('ytd', '2026-01-01', '2026-10-04')
    ],
    [
      range('year', '2025-01-01', '2025-12-31'),
      'previous',
      range('year', '2024-01-01', '2024-12-31')
    ],
    [
      range('year', '2024-01-01', '2024-12-31'),
      'next',
      range('year', '2025-01-01', '2025-12-31')
    ],
    [
      range('last_12_months', '2025-10-05', '2026-10-04'),
      'previous',
      range('year', '2025-01-01', '2025-12-31')
    ],
    [
      range('custom', '2023-03-05', '2024-06-20'),
      'previous',
      range('year', '2023-01-01', '2023-12-31')
    ],
    [
      range('custom', '2023-03-05', '2024-06-20'),
      'next',
      range('year', '2025-01-01', '2025-12-31')
    ],
    [
      range('custom', '2025-03-01', '2025-12-20'),
      'next',
      range('ytd', '2026-01-01', '2026-10-04')
    ],
    [
      range('year', '1970-01-01', '1970-12-31'),
      'next',
      range('year', '1971-01-01', '1971-12-31')
    ]
  ] as const)('%j %s', (from, direction, expected) => {
    expect(stepTarget(from, direction, TODAY)).toEqual(expected)
  })

  it.each([
    // The target is entirely in the future.
    [range('this_month', '2026-10-01', '2026-10-04'), 'next'],
    [range('ytd', '2026-01-01', '2026-10-04'), 'next'],
    [range('last_12_months', '2025-10-05', '2026-10-04'), 'next'],
    // The target is before the earliest supported year.
    [range('month', '1970-01-01', '1970-01-31'), 'previous'],
    [range('year', '1970-01-01', '1970-12-31'), 'previous']
  ] as const)('%j %s is disabled', (from, direction) => {
    expect(stepTarget(from, direction, TODAY)).toBeNull()
  })

  it('allows next into a month that started today', () => {
    expect(
      stepTarget(
        range('month', '2026-09-01', '2026-09-30'),
        'next',
        key('2026-10-01')
      )
    ).toEqual(range('this_month', '2026-10-01', '2026-10-01'))
  })

  it('steps back from the current month into December across the new year', () => {
    expect(
      stepTarget(
        range('this_month', '2026-01-01', '2026-01-15'),
        'previous',
        key('2026-01-15')
      )
    ).toEqual(range('month', '2025-12-01', '2025-12-31'))
  })
})

describe('latestMonthIn', () => {
  it.each([
    // The current month, which ends at today.
    [
      range('ytd', '2026-01-01', '2026-10-04'),
      range('this_month', '2026-10-01', '2026-10-04')
    ],
    [
      range('last_12_months', '2025-10-05', '2026-10-04'),
      range('this_month', '2026-10-01', '2026-10-04')
    ],
    // A past range opens its last month, whole.
    [
      range('year', '2025-01-01', '2025-12-31'),
      range('month', '2025-12-01', '2025-12-31')
    ],
    [
      range('year', '2024-01-01', '2024-12-31'),
      range('month', '2024-12-01', '2024-12-31')
    ],
    [
      range('custom', '2025-03-05', '2025-06-20'),
      range('month', '2025-06-01', '2025-06-30')
    ],
    [
      range('custom', '2023-12-15', '2024-02-10'),
      range('month', '2024-02-01', '2024-02-29')
    ]
  ] as const)('%j', (applied, expected) => {
    expect(latestMonthIn(applied, TODAY)).toEqual(expected)
  })
})

describe('yearsForChooser', () => {
  it.each([
    [
      'mid-year in the zone',
      Date.UTC(2021, 5, 15, 12),
      'America/Los_Angeles',
      [2026, 2025, 2024, 2023, 2022, 2021]
    ],
    // 03:00 UTC on 1 Jan is still 31 Dec in Los Angeles, already 1 Jan in Tokyo.
    [
      'before local new year',
      Date.UTC(2022, 0, 1, 3),
      'America/Los_Angeles',
      [2026, 2025, 2024, 2023, 2022, 2021]
    ],
    [
      'after local new year',
      Date.UTC(2022, 0, 1, 3),
      'Asia/Tokyo',
      [2026, 2025, 2024, 2023, 2022]
    ],
    ['this year', Date.UTC(2026, 2, 3), 'UTC', [2026]],
    ['no activity', null, 'UTC', [2026]],
    ['a non-finite instant', Number.NaN, 'UTC', [2026]],
    ['a future instant', Date.UTC(2030, 0, 1), 'UTC', [2026]]
  ])('%s', (_name, earliest, timeZone, years) => {
    expect(yearsForChooser(earliest, timeZone, TODAY)).toEqual(years)
  })

  it('never offers a year before 1970', () => {
    const years = yearsForChooser(Date.UTC(1965, 0, 1), 'UTC', TODAY)
    expect(years[0]).toBe(2026)
    expect(years[years.length - 1]).toBe(1970)
    expect(years).toHaveLength(57)
  })

  it('starts at 1970 for an activity at the Unix epoch west of UTC', () => {
    expect(yearsForChooser(0, 'America/Los_Angeles', TODAY).at(-1)).toBe(1970)
  })
})

describe('rederiveRange', () => {
  it.each([
    [
      range('this_month', '2026-10-01', '2026-10-31'),
      '2026-11-01',
      range('this_month', '2026-11-01', '2026-11-01')
    ],
    [
      range('ytd', '2026-01-01', '2026-12-31'),
      '2027-01-01',
      range('ytd', '2027-01-01', '2027-01-01')
    ],
    [
      range('last_12_months', '2025-11-01', '2026-10-31'),
      '2026-11-01',
      range('last_12_months', '2025-11-02', '2026-11-01')
    ],
    // Whole months and years that ended stay put.
    [
      range('month', '2026-09-01', '2026-09-30'),
      '2026-11-01',
      range('month', '2026-09-01', '2026-09-30')
    ],
    [
      range('year', '2025-01-01', '2025-12-31'),
      '2027-01-01',
      range('year', '2025-01-01', '2025-12-31')
    ],
    [
      range('custom', '2026-03-02', '2026-03-20'),
      '2026-11-01',
      range('custom', '2026-03-02', '2026-03-20')
    ],
    // The clock moved back (a time-zone change): ranges follow it.
    [
      range('month', '2026-10-01', '2026-10-31'),
      '2026-10-04',
      range('this_month', '2026-10-01', '2026-10-04')
    ],
    [
      range('year', '2026-01-01', '2026-12-31'),
      '2026-10-04',
      range('ytd', '2026-01-01', '2026-10-04')
    ],
    [
      range('month', '2026-10-01', '2026-10-31'),
      '2026-09-30',
      range('ytd', '2026-01-01', '2026-09-30')
    ],
    [
      range('custom', '2026-09-20', '2026-10-04'),
      '2026-09-30',
      range('custom', '2026-09-20', '2026-09-30')
    ],
    [
      range('custom', '2026-10-01', '2026-10-04'),
      '2026-09-30',
      range('ytd', '2026-01-01', '2026-09-30')
    ]
  ] as const)('%j on %s', (applied, today, expected) => {
    expect(rederiveRange(applied, key(today))).toEqual(expected)
  })
})

describe('validateDraft', () => {
  const draft = (
    fromText: string,
    toText: string,
    kind: DraftKind = 'custom'
  ) => ({
    fromText,
    toText,
    kind
  })

  describe('a valid custom range', () => {
    it.each([
      // Exactly seven days, both ends included.
      ['2026-09-01', '2026-09-07', range('custom', '2026-09-01', '2026-09-07')],
      // Ending today is allowed.
      ['2026-09-28', '2026-10-04', range('custom', '2026-09-28', '2026-10-04')],
      // Across a leap day: 25 Feb to 2 Mar 2024 is seven days.
      ['2024-02-25', '2024-03-02', range('custom', '2024-02-25', '2024-03-02')],
      // Across the new year.
      ['2025-12-29', '2026-01-04', range('custom', '2025-12-29', '2026-01-04')],
      ['1970-01-01', '1970-01-07', range('custom', '1970-01-01', '1970-01-07')],
      // Surrounding whitespace is ignored.
      [
        ' 2026-09-01 ',
        '\t2026-09-07\n',
        range('custom', '2026-09-01', '2026-09-07')
      ],
      // Ranges that are a whole month or year take that kind.
      ['2026-09-01', '2026-09-30', range('month', '2026-09-01', '2026-09-30')],
      ['2025-01-01', '2025-12-31', range('year', '2025-01-01', '2025-12-31')],
      // A custom range equal to a preset takes the preset's kind.
      [
        '2025-10-05',
        '2026-10-04',
        range('last_12_months', '2025-10-05', '2026-10-04')
      ]
    ])('%s to %s', (fromText, toText, expected) => {
      expect(validateDraft(draft(fromText, toText), TODAY)).toEqual({
        ok: true,
        range: expected
      })
    })
  })

  describe('rejects a custom range with an error code', () => {
    it.each([
      ['', '2026-09-07', ['from_missing']],
      ['   ', '2026-09-07', ['from_missing']],
      ['2026-09-01', '', ['to_missing']],
      ['', '', ['from_missing', 'to_missing']],
      ['2026-13-01', '2026-09-07', ['from_malformed']],
      ['2026-02-30', '2026-09-07', ['from_malformed']],
      ['2100-02-29', '2026-09-07', ['from_malformed']],
      ['10/04/2026', '2026-09-07', ['from_malformed']],
      ['2026-9-1', '2026-09-07', ['from_malformed']],
      ['2026-09-01', 'tomorrow', ['to_malformed']],
      ['nope', 'nope', ['from_malformed', 'to_malformed']],
      // Missing one end and malformed the other report both, without inverting.
      ['', 'nope', ['from_missing', 'to_malformed']],
      // Start after end.
      ['2026-09-10', '2026-09-01', ['range_inverted']],
      // The end cannot be after today.
      ['2026-09-20', '2026-10-05', ['to_after_today']],
      ['2026-09-20', '2027-01-01', ['to_after_today']],
      // Before 1970.
      ['1969-12-25', '1970-01-10', ['from_before_minimum']],
      ['0001-01-01', '2026-09-07', ['from_before_minimum']],
      [
        '1960-01-01',
        '1960-02-01',
        ['from_before_minimum', 'to_before_minimum']
      ],
      // A future end and an inverted pair are both reported.
      ['2026-10-10', '2026-10-08', ['to_after_today', 'range_inverted']],
      // Fewer than seven days, both ends included.
      ['2026-09-01', '2026-09-06', ['range_too_short']],
      ['2026-09-01', '2026-09-01', ['range_too_short']],
      ['2026-10-01', '2026-10-04', ['range_too_short']],
      ['2024-02-25', '2024-03-01', ['range_too_short']],
      ['2025-12-29', '2026-01-03', ['range_too_short']]
    ])('%j to %j gives %j', (fromText, toText, codes) => {
      const result = validateDraft(draft(fromText, toText), TODAY)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.errors.map((error) => error.code)).toEqual(codes)
    })
  })

  it.each([
    ['from_missing', 'from'],
    ['from_malformed', 'from'],
    ['from_before_minimum', 'from'],
    ['to_missing', 'to'],
    ['to_malformed', 'to'],
    ['to_before_minimum', 'to'],
    ['to_after_today', 'to'],
    ['range_inverted', 'range'],
    ['range_too_short', 'range']
  ] as Array<[DraftErrorCode, string]>)(
    'attaches %s to the %s field with its message',
    (code, field) => {
      const inputs: Record<DraftErrorCode, [string, string]> = {
        from_missing: ['', '2026-09-07'],
        from_malformed: ['x', '2026-09-07'],
        from_before_minimum: ['1969-01-01', '2026-09-07'],
        to_missing: ['2026-09-01', ''],
        to_malformed: ['2026-09-01', 'x'],
        to_before_minimum: ['1960-01-01', '1960-02-01'],
        to_after_today: ['2026-09-20', '2026-10-05'],
        range_inverted: ['2026-09-10', '2026-09-01'],
        range_too_short: ['2026-09-01', '2026-09-02']
      }
      const [fromText, toText] = inputs[code]
      const result = validateDraft(draft(fromText, toText), TODAY)
      expect(result.ok).toBe(false)
      if (result.ok) return
      const error = result.errors.find((candidate) => candidate.code === code)
      expect(error).toEqual({
        field,
        code,
        message: DRAFT_ERROR_MESSAGES[code]
      })
    }
  )

  describe('This month and Year to date are exempt from the seven-day rule', () => {
    it.each([
      // Days 1 to 6 of a month.
      ['2026-10-01'],
      ['2026-10-02'],
      ['2026-10-03'],
      ['2026-10-04'],
      ['2026-10-05'],
      ['2026-10-06'],
      // Days 1 to 6 of the year.
      ['2026-01-01'],
      ['2026-01-03'],
      ['2026-01-06']
    ])('on %s', (todayText) => {
      const today = key(todayText)
      for (const kind of ['this_month', 'ytd'] as const) {
        const preset = presetRange(kind, today)
        const texts = presetDraftTexts(kind, today)
        if (inclusiveDayCount(preset.from, preset.to) >= 7) continue

        expect(validateDraft({ ...texts, kind }, today)).toEqual({
          ok: true,
          range: preset
        })
        // The same dates typed as a custom range are too short.
        const custom = validateDraft({ ...texts, kind: 'custom' }, today)
        expect(custom.ok).toBe(false)
        if (!custom.ok) {
          expect(custom.errors.map((error) => error.code)).toEqual([
            'range_too_short'
          ])
        }
      }
    })

    it('covers both presets on the same short day', () => {
      const today = key('2026-01-03')
      for (const kind of ['this_month', 'ytd'] as const) {
        expect(
          validateDraft({ ...presetDraftTexts(kind, today), kind }, today)
        ).toEqual({ ok: true, range: presetRange(kind, today) })
      }
    })

    it('does not exempt a preset whose dates are stale', () => {
      // Yesterday's year-to-date dates on a day when the range is short.
      const result = validateDraft(
        draft('2026-01-01', '2026-01-02', 'ytd'),
        key('2026-01-03')
      )
      expect(result.ok).toBe(false)
    })

    it('does not exempt a preset edited to other dates', () => {
      const result = validateDraft(
        draft('2026-09-01', '2026-09-03', 'this_month'),
        TODAY
      )
      expect(result.ok).toBe(false)
    })

    it('accepts Last 12 months on any day', () => {
      for (const today of ['2024-02-29', '2026-03-31', '2026-01-01']) {
        const kind: PresetKind = 'last_12_months'
        const texts = presetDraftTexts(kind, key(today))
        expect(validateDraft({ ...texts, kind }, key(today))).toEqual({
          ok: true,
          range: presetRange(kind, key(today))
        })
      }
    })

    it('still rejects a preset draft with a missing field', () => {
      const result = validateDraft(draft('2026-10-01', '', 'this_month'), TODAY)
      expect(result.ok).toBe(false)
    })
  })
})
