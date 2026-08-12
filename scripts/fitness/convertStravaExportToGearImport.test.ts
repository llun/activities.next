import {
  buildAssignments,
  parseArgs,
  parseStravaActivitiesCsv,
  parseStravaExportDate
} from './convertStravaExportToGearImport'

// The real export repeats five header names; "Distance" appears twice and only
// the second one is in meters.
const HEADER =
  'Activity ID,Activity Date,Activity Name,Activity Type,Distance,Activity Gear,Filename,Distance'

const csvOf = (...rows: string[]) => [HEADER, ...rows].join('\n')

describe('parseArgs', () => {
  it('requires every path', () => {
    expect(() => parseArgs([])).toThrow()
    expect(() => parseArgs(['--export-dir', './export'])).toThrow()
  })

  it('reads the three paths', () => {
    expect(
      parseArgs([
        '--export-dir',
        './export',
        '--gears=./gears.json',
        '--output',
        './out.json'
      ])
    ).toEqual({
      exportDir: './export',
      gears: './gears.json',
      output: './out.json'
    })
  })
})

describe('parseStravaExportDate', () => {
  it.each([
    {
      description: 'an afternoon time',
      value: 'Aug 10, 2026, 3:43:45 PM',
      expected: Date.UTC(2026, 7, 10, 15, 43, 45)
    },
    {
      description: 'a morning time',
      value: 'Oct 6, 2015, 9:44:23 AM',
      expected: Date.UTC(2015, 9, 6, 9, 44, 23)
    },
    {
      description: 'midnight',
      value: 'Jan 1, 2020, 12:05:00 AM',
      expected: Date.UTC(2020, 0, 1, 0, 5, 0)
    },
    {
      description: 'noon',
      value: 'Jan 1, 2020, 12:05:00 PM',
      expected: Date.UTC(2020, 0, 1, 12, 5, 0)
    }
  ])('reads $description as UTC', ({ value, expected }) => {
    expect(parseStravaExportDate(value)).toBe(expected)
  })

  it.each([
    { description: 'an empty value', value: '' },
    { description: 'an ISO date', value: '2026-08-10T15:43:45Z' },
    { description: 'a 24-hour time', value: 'Aug 10, 2026, 15:43:45 PM' },
    { description: 'a non-English month', value: 'Aoû 10, 2026, 3:43:45 PM' }
  ])('throws on $description', ({ value }) => {
    expect(() => parseStravaExportDate(value)).toThrow()
  })
})

describe('parseStravaActivitiesCsv', () => {
  it('reads the meters column rather than the first Distance', () => {
    const rows = parseStravaActivitiesCsv(
      csvOf(
        '123,"Oct 6, 2015, 9:44:23 AM",Morning Ride,Ride,12.5,Moots,activities/123.gpx,12500'
      )
    )
    expect(rows).toEqual([
      {
        activityId: '123',
        timeMilliseconds: Date.UTC(2015, 9, 6, 9, 44, 23),
        activityType: 'Ride',
        gear: 'Moots',
        fileName: 'activities/123.gpx',
        distanceMeters: 12500
      }
    ])
  })

  it('reads a row with no gear', () => {
    const rows = parseStravaActivitiesCsv(
      csvOf(
        '124,"Oct 7, 2015, 9:44:23 AM",Gym,Weight Training,,,activities/124.fit.gz,'
      )
    )
    expect(rows[0]).toMatchObject({ gear: '', distanceMeters: null })
  })

  it('throws when a required column is missing', () => {
    expect(() =>
      parseStravaActivitiesCsv(
        'Activity ID,Activity Date\n1,"Oct 6, 2015, 9:44:23 AM"'
      )
    ).toThrow(/missing the "Activity Type" column/)
  })

  it('throws on an empty file', () => {
    expect(() => parseStravaActivitiesCsv('')).toThrow(/empty/)
  })

  it('names the line and column count of a row it cannot read', () => {
    expect(() =>
      parseStravaActivitiesCsv(
        csvOf(
          '123,"Oct 6, 2015, 9:44:23 AM",Ride,Ride,12.5,Moots,f.gpx,12500',
          '124,not-a-date,Ride,Ride,12.5,Moots,f.gpx,12500'
        )
      )
    ).toThrow(
      /line 3 \(8 columns\): Unparseable Strava activity date: not-a-date/
    )
  })
})

describe('buildAssignments', () => {
  const rows = [
    {
      activityId: '123',
      timeMilliseconds: Date.UTC(2015, 9, 6, 9, 44, 23),
      activityType: 'Ride',
      gear: 'Moots',
      fileName: 'activities/123.fit.gz',
      distanceMeters: 12500
    },
    {
      activityId: '124',
      timeMilliseconds: Date.UTC(2015, 9, 7, 9, 44, 23),
      activityType: 'Weight Training',
      gear: '',
      fileName: 'activities/124.fit.gz',
      distanceMeters: null
    }
  ]

  it('emits one assignment per activity that names gear', () => {
    const result = buildAssignments({ rows, knownGearNames: ['Moots'] })
    expect(result.assignments).toEqual([
      {
        time: '2015-10-06T09:44:23.000Z',
        gear: 'Moots',
        stravaActivityId: '123',
        filename: '123.fit'
      }
    ])
  })

  it('counts the activities it skipped by type', () => {
    const result = buildAssignments({ rows, knownGearNames: ['Moots'] })
    expect(result.skippedByType).toEqual({ 'Weight Training': 1 })
  })

  it('totals distance per gear for cross-checking', () => {
    const result = buildAssignments({ rows, knownGearNames: ['Moots'] })
    expect(result.reports).toEqual([
      { gearName: 'Moots', assignmentCount: 1, distanceMeters: 12500 }
    ])
  })

  it('collects gear names the gears file does not describe', () => {
    const result = buildAssignments({ rows, knownGearNames: ['Giant'] })
    expect(result.unknownGear).toEqual(['Moots'])
  })

  it('matches known gear names case-insensitively', () => {
    const result = buildAssignments({ rows, knownGearNames: ['moots'] })
    expect(result.unknownGear).toHaveLength(0)
  })

  it('counts gear rows whose distance would not parse', () => {
    const result = buildAssignments({
      rows: [{ ...rows[0], distanceMeters: null }],
      knownGearNames: ['Moots']
    })
    expect(result.unreadableDistanceCount).toBe(1)
    expect(result.reports[0].distanceMeters).toBe(0)
  })
})
