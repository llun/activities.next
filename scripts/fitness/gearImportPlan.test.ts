import {
  ImportGear,
  MatchableFitnessFile,
  applyWindows,
  diffGearComponents,
  findUnattributedActivities,
  matchAssignmentsToFiles,
  parseGearImportFile
} from './gearImportPlan'

const gearEntry = (overrides: Partial<ImportGear> = {}) => ({
  name: 'Moots',
  kind: 'bike' as const,
  ...overrides
})

const validFile = (overrides: Record<string, unknown> = {}) => ({
  gears: [gearEntry()],
  assignments: [],
  ...overrides
})

const parseOrThrow = (input: unknown) => {
  const result = parseGearImportFile(input)
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result.file
}

describe('parseGearImportFile', () => {
  it('parses a minimal file', () => {
    const file = parseOrThrow(validFile())
    expect(file.gears[0]).toMatchObject({
      name: 'Moots',
      kind: 'bike',
      retired: false,
      components: [],
      windows: []
    })
  })

  it.each([
    {
      description: 'duplicate gear names differing only by case',
      input: validFile({ gears: [gearEntry(), gearEntry({ name: 'moots' })] }),
      error: /duplicate gear name/
    },
    {
      description: 'bikeType on shoes',
      input: validFile({
        gears: [gearEntry({ kind: 'shoes', bikeType: 'Road bike' })]
      }),
      error: /bikeType is only valid for a bike/
    },
    {
      description: 'alertDistanceMeters on a bike',
      input: validFile({
        gears: [gearEntry({ alertDistanceMeters: 500_000 })]
      }),
      error: /alertDistanceMeters is only valid for shoes/
    },
    {
      description: 'a run default sport on a bike',
      input: validFile({ gears: [gearEntry({ defaultSports: ['run'] })] }),
      error: /run is not a bike sport/
    },
    {
      description: 'the same default sport on two gears',
      input: validFile({
        gears: [
          gearEntry({ defaultSports: ['ride'] }),
          gearEntry({ name: 'Giant', defaultSports: ['ride'] })
        ]
      }),
      error: /claimed by both/
    },
    {
      description: 'an assignment naming unknown gear',
      input: validFile({
        assignments: [{ time: '2024-01-06T10:26:21Z', gear: 'Brompton' }]
      }),
      error: /unknown gear "Brompton"/
    },
    {
      description: 'an assignment time without a zone',
      input: validFile({
        assignments: [{ time: '2024-01-06T10:26:21', gear: 'Moots' }]
      }),
      error: /explicit Z\/offset/
    },
    {
      description: 'removedAt before addedAt',
      input: validFile({
        gears: [
          gearEntry({
            components: [
              { type: 'Chain', addedAt: '2024-02-01', removedAt: '2024-01-01' }
            ]
          })
        ]
      }),
      error: /removedAt must be after addedAt/
    },
    {
      description: 'overlapping windows claiming the same sport',
      input: validFile({
        gears: [
          gearEntry({ windows: [{ from: '2020-01-01', to: '2022-01-01' }] }),
          gearEntry({
            name: 'Giant',
            windows: [{ from: '2021-01-01', to: '2023-01-01' }]
          })
        ]
      }),
      error: /overlap in time and both claim/
    },
    {
      description: 'a window listing a sport of the wrong kind',
      input: validFile({
        gears: [
          gearEntry({ windows: [{ from: '2020-01-01', sports: ['run'] }] })
        ]
      }),
      error: /is not a bike sport/
    }
  ])('rejects $description', ({ input, error }) => {
    const result = parseGearImportFile(input)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join('; ')).toMatch(error)
  })

  it('reads a day-precision date as UTC midnight', () => {
    const file = parseOrThrow(
      validFile({
        gears: [
          gearEntry({ components: [{ type: 'Chain', addedAt: '2020-10-19' }] })
        ]
      })
    )
    expect(file.gears[0].components[0].addedAt).toBe(Date.UTC(2020, 9, 19))
  })

  it('keeps the offset of a full datetime', () => {
    const file = parseOrThrow(
      validFile({
        assignments: [{ time: '2015-10-06T11:44:23+02:00', gear: 'Moots' }]
      })
    )
    expect(file.assignments[0].time).toBe(Date.UTC(2015, 9, 6, 9, 44, 23))
  })

  it('leaves an absent addedAt absent', () => {
    const file = parseOrThrow(
      validFile({ gears: [gearEntry({ components: [{ type: 'Frame' }] })] })
    )
    expect(file.gears[0].components[0].addedAt).toBeUndefined()
  })

  it('allows windows of different gears to overlap on different sports', () => {
    const result = parseGearImportFile(
      validFile({
        gears: [
          gearEntry({ windows: [{ from: '2020-01-01', sports: ['ride'] }] }),
          gearEntry({
            name: 'Rocket',
            windows: [{ from: '2020-01-01', sports: ['virtual_ride'] }]
          })
        ]
      })
    )
    expect(result.ok).toBe(true)
  })
})

describe('matchAssignmentsToFiles', () => {
  const baseTime = Date.UTC(2024, 0, 6, 10, 26, 21)
  const gearKindByName = new Map<string, 'bike' | 'shoes'>([
    ['moots', 'bike'],
    ['asics dynamis', 'shoes']
  ])

  const file = (
    overrides: Partial<MatchableFitnessFile> = {}
  ): MatchableFitnessFile => ({
    id: 'file-1',
    fileName: 'ride.gpx',
    activityStartTime: baseTime,
    activityType: 'Ride',
    ...overrides
  })

  const match = ({
    files,
    time = baseTime,
    gear = 'Moots',
    toleranceMilliseconds = 60_000
  }: {
    files: MatchableFitnessFile[]
    time?: number
    gear?: string
    toleranceMilliseconds?: number
  }) =>
    matchAssignmentsToFiles({
      assignments: [{ time, gear, stravaActivityId: null }],
      files,
      toleranceMilliseconds,
      gearKindByName
    })

  it('matches an exact timestamp', () => {
    const result = match({ files: [file()] })
    expect(result.matches[0].outcome).toMatchObject({
      kind: 'matched',
      fileId: 'file-1',
      deltaMilliseconds: 0
    })
    expect([...result.reservedFileIds]).toEqual(['file-1'])
  })

  it.each([
    { description: 'inside the tolerance', offset: 59_000, kind: 'matched' },
    { description: 'outside the tolerance', offset: 61_000, kind: 'unmatched' }
  ])('reports a file $description', ({ offset, kind }) => {
    const result = match({
      files: [file({ activityStartTime: baseTime + offset })]
    })
    expect(result.matches[0].outcome.kind).toBe(kind)
  })

  it('reports how far the nearest activity was when nothing matched', () => {
    const result = match({
      files: [file({ activityStartTime: baseTime + 3_600_000 })]
    })
    expect(result.matches[0].outcome).toEqual({
      kind: 'unmatched',
      nearestDeltaMilliseconds: 3_600_000
    })
  })

  it('picks the nearest of two candidates', () => {
    const result = match({
      files: [
        file({ id: 'far', activityStartTime: baseTime + 40_000 }),
        file({ id: 'near', activityStartTime: baseTime + 5_000 })
      ]
    })
    expect(result.matches[0].outcome).toMatchObject({
      kind: 'matched',
      fileId: 'near'
    })
  })

  it('skips equidistant candidates rather than guessing', () => {
    const result = match({
      files: [
        file({ id: 'before', activityStartTime: baseTime - 10_000 }),
        file({ id: 'after', activityStartTime: baseTime + 10_000 })
      ]
    })
    expect(result.matches[0].outcome.kind).toBe('ambiguous')
    // Reserved even though unresolved, so a window cannot take a ride the file
    // already said belonged to a different gear.
    expect([...result.reservedFileIds].sort()).toEqual(['after', 'before'])
  })

  it('reports a second assignment landing on a claimed file', () => {
    const result = matchAssignmentsToFiles({
      assignments: [
        { time: baseTime, gear: 'Moots', stravaActivityId: null },
        { time: baseTime + 1_000, gear: 'Moots', stravaActivityId: null }
      ],
      files: [file()],
      toleranceMilliseconds: 60_000,
      gearKindByName
    })
    expect(result.matches[0].outcome.kind).toBe('matched')
    expect(result.matches[1].outcome).toMatchObject({
      kind: 'conflict',
      fileId: 'file-1',
      claimedByAssignmentIndex: 0
    })
    expect([...result.reservedFileIds]).toEqual(['file-1'])
  })

  it('never matches a file without a start time', () => {
    const result = match({
      files: [file({ activityStartTime: undefined })]
    })
    expect(result.matches[0].outcome.kind).toBe('unmatched')
    expect(result.timestamplessFileCount).toBe(1)
  })

  it('flags a run assigned to a bike', () => {
    const result = match({ files: [file({ activityType: 'Run' })] })
    expect(result.matches[0].outcome).toMatchObject({ kindMismatch: true })
  })

  it.each([
    { description: 'an unrecognised activity type', activityType: 'Yoga' },
    { description: 'a matching sport', activityType: 'GravelRide' }
  ])('does not flag $description', ({ activityType }) => {
    const result = match({ files: [file({ activityType })] })
    expect(result.matches[0].outcome).toMatchObject({ kindMismatch: false })
  })

  it('reports a matched file that already carries gear', () => {
    const result = match({ files: [file({ gearId: 'gear-1' })] })
    expect(result.matches[0].outcome).toMatchObject({ alreadyAssigned: true })
  })

  describe('identity matching', () => {
    const identityMatch = ({
      files,
      time = baseTime,
      stravaActivityId = null,
      filename = null
    }: {
      files: MatchableFitnessFile[]
      time?: number
      stravaActivityId?: string | null
      filename?: string | null
    }) =>
      matchAssignmentsToFiles({
        assignments: [{ time, gear: 'Moots', stravaActivityId, filename }],
        files,
        toleranceMilliseconds: 60_000,
        gearKindByName
      })

    it.each([
      {
        description: 'the source URL',
        overrides: {
          sourceUrl: 'https://www.strava.com/activities/19812110930'
        }
      },
      {
        description: 'the webhook file name',
        overrides: { fileName: 'strava-19812110930.tcx' }
      }
    ])(
      'matches on the Strava activity id in $description, past the time tolerance',
      ({ overrides }) => {
        const result = identityMatch({
          // A day away: unreachable by time, so only the id can have matched it.
          files: [
            file({ activityStartTime: baseTime + 86_400_000, ...overrides })
          ],
          stravaActivityId: '19812110930'
        })
        expect(result.matches[0].outcome).toMatchObject({
          kind: 'matched',
          fileId: 'file-1',
          matchedBy: 'strava-id'
        })
      }
    )

    it('matches on the archive file name when there is no Strava id', () => {
      const result = identityMatch({
        files: [
          file({
            fileName: 'activities/12345.gpx',
            activityStartTime: baseTime + 86_400_000
          })
        ],
        filename: '12345.gpx'
      })
      expect(result.matches[0].outcome).toMatchObject({
        kind: 'matched',
        matchedBy: 'filename'
      })
    })

    it('matches a file that has no start time at all', () => {
      const result = identityMatch({
        files: [
          file({
            activityStartTime: undefined,
            sourceUrl: 'https://www.strava.com/activities/777'
          })
        ],
        stravaActivityId: '777'
      })
      expect(result.matches[0].outcome).toMatchObject({
        kind: 'matched',
        matchedBy: 'strava-id'
      })
    })

    it('prefers the identity match over a nearer file in time', () => {
      const result = identityMatch({
        files: [
          file({ id: 'nearer', activityStartTime: baseTime }),
          file({
            id: 'by-id',
            activityStartTime: baseTime + 30_000,
            sourceUrl: 'https://www.strava.com/activities/42'
          })
        ],
        stravaActivityId: '42'
      })
      expect(result.matches[0].outcome).toMatchObject({
        kind: 'matched',
        fileId: 'by-id',
        matchedBy: 'strava-id'
      })
    })

    it('leaves a file an identity match claimed out of a later time match', () => {
      const result = matchAssignmentsToFiles({
        assignments: [
          // Ordered so the time-matching entry comes first: identity resolves in
          // its own pass, so claim order must not depend on assignment order.
          { time: baseTime, gear: 'Moots', stravaActivityId: null },
          { time: baseTime, gear: 'Moots', stravaActivityId: '42' }
        ],
        files: [
          file({
            id: 'by-id',
            sourceUrl: 'https://www.strava.com/activities/42'
          })
        ],
        toleranceMilliseconds: 60_000,
        gearKindByName
      })
      expect(result.matches[1].outcome).toMatchObject({
        kind: 'matched',
        matchedBy: 'strava-id'
      })
      expect(result.matches[0].outcome).toMatchObject({
        kind: 'conflict',
        fileId: 'by-id',
        claimedByAssignmentIndex: 1
      })
    })

    it('reports two files carrying the same Strava id rather than guessing', () => {
      const result = identityMatch({
        files: [
          file({
            id: 'twin-a',
            sourceUrl: 'https://www.strava.com/activities/42'
          }),
          file({
            id: 'twin-b',
            fileName: 'strava-42.gpx',
            activityStartTime: baseTime + 1_000
          })
        ],
        stravaActivityId: '42'
      })
      expect(result.matches[0].outcome).toMatchObject({ kind: 'ambiguous' })
      expect([...result.reservedFileIds].sort()).toEqual(['twin-a', 'twin-b'])
    })

    it('falls back to time when the id names no file', () => {
      const result = identityMatch({
        files: [file()],
        stravaActivityId: '19812110930'
      })
      expect(result.matches[0].outcome).toMatchObject({
        kind: 'matched',
        matchedBy: 'time'
      })
    })

    it('falls back to time when a file name is not unique', () => {
      const result = identityMatch({
        files: [
          file({ id: 'near', fileName: 'activity.gpx' }),
          file({
            id: 'far',
            fileName: 'activity.gpx',
            activityStartTime: baseTime + 30_000
          })
        ],
        filename: 'activity.gpx'
      })
      expect(result.matches[0].outcome).toMatchObject({
        kind: 'matched',
        fileId: 'near',
        matchedBy: 'time'
      })
    })

    it('ignores the file name once the Strava id has named a file', () => {
      const result = identityMatch({
        files: [
          file({
            id: 'by-id',
            fileName: 'from-strava.tcx',
            sourceUrl: 'https://www.strava.com/activities/42'
          }),
          file({
            id: 'by-name',
            fileName: 'ride.gpx',
            activityStartTime: baseTime + 30_000
          })
        ],
        stravaActivityId: '42',
        filename: 'ride.gpx'
      })
      expect(result.matches[0].outcome).toMatchObject({
        kind: 'matched',
        fileId: 'by-id',
        matchedBy: 'strava-id'
      })
    })
  })
})

describe('findUnattributedActivities', () => {
  const activity = (
    overrides: Partial<MatchableFitnessFile> = {}
  ): MatchableFitnessFile => ({
    id: 'file-1',
    fileName: 'ride.tcx',
    activityStartTime: Date.UTC(2023, 5, 1),
    activityType: 'Ride',
    processingStatus: 'completed',
    totalDistanceMeters: 42_000,
    ...overrides
  })

  const find = (
    files: MatchableFitnessFile[],
    reserved: string[] = [],
    windowed: string[] = []
  ) =>
    findUnattributedActivities({
      files,
      reservedFileIds: new Set(reserved),
      windowAssignedFileIds: new Set(windowed)
    })

  it('reports an activity no assignment or window reached', () => {
    expect(find([activity()])).toMatchObject([
      { fileId: 'file-1', sportKey: 'ride', totalDistanceMeters: 42_000 }
    ])
  })

  it.each([
    { description: 'already carries gear', overrides: { gearId: 'gear-1' } },
    {
      description: 'is not completed',
      overrides: { processingStatus: 'processing' }
    },
    {
      description: 'has no distance to contribute',
      overrides: { totalDistanceMeters: 0 }
    }
  ])('skips an activity that $description', ({ overrides }) => {
    expect(find([activity(overrides)])).toEqual([])
  })

  it.each([
    {
      description: 'an assignment reserved',
      reserved: ['file-1'],
      windowed: []
    },
    { description: 'a window took', reserved: [], windowed: ['file-1'] }
  ])('skips an activity $description', ({ reserved, windowed }) => {
    expect(find([activity()], reserved, windowed)).toEqual([])
  })

  it('reports an unrecognised sport with a null key, since nothing can attribute it', () => {
    expect(find([activity({ activityType: 'Kayaking' })])).toMatchObject([
      { fileId: 'file-1', sportKey: null }
    ])
  })

  it('orders the report oldest first', () => {
    const result = find([
      activity({ id: 'newer', activityStartTime: Date.UTC(2024, 0, 1) }),
      activity({ id: 'older', activityStartTime: Date.UTC(2022, 0, 1) })
    ])
    expect(result.map((entry) => entry.fileId)).toEqual(['older', 'newer'])
  })
})

describe('applyWindows', () => {
  const gear = (overrides: Partial<ImportGear> = {}) =>
    parseGearImportFile({
      gears: [{ name: 'Moots', kind: 'bike', ...overrides }],
      assignments: []
    })

  const gearsOf = (overrides: Partial<ImportGear> = {}): ImportGear[] => {
    const result = gear(overrides)
    if (!result.ok) throw new Error(result.errors.join('; '))
    return result.file.gears
  }

  const ride = (
    id: string,
    startTime: number,
    overrides: Partial<MatchableFitnessFile> = {}
  ): MatchableFitnessFile => ({
    id,
    fileName: `${id}.gpx`,
    activityStartTime: startTime,
    activityType: 'Ride',
    ...overrides
  })

  it('assigns an activity inside the window', () => {
    const assignments = applyWindows({
      gears: gearsOf({ windows: [{ from: '2020-01-01', to: '2021-01-01' }] }),
      files: [ride('a', Date.UTC(2020, 5, 1))],
      reservedFileIds: new Set()
    })
    expect(assignments).toEqual([
      {
        fileId: 'a',
        fileName: 'a.gpx',
        gearName: 'Moots',
        activityStartTime: Date.UTC(2020, 5, 1)
      }
    ])
  })

  it.each([
    {
      description: 'the start instant',
      time: Date.UTC(2020, 0, 1),
      assigned: true
    },
    {
      description: 'the end instant',
      time: Date.UTC(2021, 0, 1),
      assigned: false
    }
  ])('treats the window as half-open at $description', ({ time, assigned }) => {
    const assignments = applyWindows({
      gears: gearsOf({ windows: [{ from: '2020-01-01', to: '2021-01-01' }] }),
      files: [ride('a', time)],
      reservedFileIds: new Set()
    })
    expect(assignments).toHaveLength(assigned ? 1 : 0)
  })

  it.each([
    {
      description: 'a file an assignment already claimed',
      files: [ride('a', Date.UTC(2020, 5, 1))],
      claimed: ['a']
    },
    {
      description: 'a file that already has gear',
      files: [ride('a', Date.UTC(2020, 5, 1), { gearId: 'gear-1' })],
      claimed: []
    },
    {
      description: 'a sport of the wrong kind',
      files: [ride('a', Date.UTC(2020, 5, 1), { activityType: 'Run' })],
      claimed: []
    },
    {
      description: 'an activity the normalizer has no opinion on',
      files: [
        ride('a', Date.UTC(2020, 5, 1), { activityType: 'Weight Training' })
      ],
      claimed: []
    },
    {
      description: 'a file with no start time',
      files: [
        ride('a', Date.UTC(2020, 5, 1), { activityStartTime: undefined })
      ],
      claimed: []
    }
  ])('skips $description', ({ files, claimed }) => {
    const assignments = applyWindows({
      gears: gearsOf({ windows: [{ from: '2020-01-01', to: '2021-01-01' }] }),
      files,
      reservedFileIds: new Set(claimed)
    })
    expect(assignments).toHaveLength(0)
  })

  it('honours a window restricted to specific sports', () => {
    const gears = gearsOf({
      windows: [{ from: '2020-01-01', sports: ['virtual_ride'] }]
    })
    const assignments = applyWindows({
      gears,
      files: [
        ride('outdoor', Date.UTC(2020, 5, 1)),
        ride('indoor', Date.UTC(2020, 5, 2), { activityType: 'VirtualRide' })
      ],
      reservedFileIds: new Set()
    })
    expect(assignments.map((assignment) => assignment.fileId)).toEqual([
      'indoor'
    ])
  })

  it('leaves an activity outside every window unassigned', () => {
    const assignments = applyWindows({
      gears: gearsOf({ windows: [{ from: '2020-01-01', to: '2021-01-01' }] }),
      files: [ride('a', Date.UTC(2019, 5, 1))],
      reservedFileIds: new Set()
    })
    expect(assignments).toHaveLength(0)
  })

  it('never takes an activity an unresolved assignment named', () => {
    // Two activities share a start time, so the assignment naming Moots ties and
    // is skipped. A window on another bike covering the same period must not
    // then take them: the file says those rides were on the Moots.
    const parsed = parseGearImportFile({
      gears: [
        { name: 'Moots', kind: 'bike' },
        { name: 'Giant', kind: 'bike', windows: [{ from: '2024-01-01' }] }
      ],
      assignments: [{ time: '2024-06-01T10:00:00Z', gear: 'Moots' }]
    })
    if (!parsed.ok) throw new Error(parsed.errors.join('; '))

    const twins = [
      ride('fit', Date.UTC(2024, 5, 1, 10)),
      ride('gpx', Date.UTC(2024, 5, 1, 10))
    ]
    const { matches, reservedFileIds } = matchAssignmentsToFiles({
      assignments: parsed.file.assignments,
      files: twins,
      toleranceMilliseconds: 60_000,
      gearKindByName: new Map([
        ['moots', 'bike'],
        ['giant', 'bike']
      ])
    })
    expect(matches[0].outcome.kind).toBe('ambiguous')

    const assignments = applyWindows({
      gears: parsed.file.gears,
      files: twins,
      reservedFileIds
    })
    expect(assignments).toHaveLength(0)
  })
})

describe('diffGearComponents', () => {
  const chain = (addedAt?: number) => ({
    type: 'Chain',
    brand: 'Shimano',
    model: 'CN-HG901-11',
    addedAt
  })

  it('skips a component that already exists', () => {
    const missing = diffGearComponents({
      components: [chain(Date.UTC(2020, 0, 1))],
      existing: [
        {
          componentType: 'Chain',
          brand: 'Shimano',
          model: 'CN-HG901-11',
          addedAt: Date.UTC(2020, 0, 1)
        }
      ]
    })
    expect(missing).toHaveLength(0)
  })

  it('creates a replacement fitted on a different date', () => {
    const missing = diffGearComponents({
      components: [chain(Date.UTC(2020, 0, 1)), chain(Date.UTC(2021, 0, 1))],
      existing: [
        {
          componentType: 'Chain',
          brand: 'Shimano',
          model: 'CN-HG901-11',
          addedAt: Date.UTC(2020, 0, 1)
        }
      ]
    })
    expect(missing).toEqual([chain(Date.UTC(2021, 0, 1))])
  })

  it('matches a component installed since the beginning', () => {
    const missing = diffGearComponents({
      components: [{ type: 'Frame', brand: 'Moots', model: 'Vamoots' }],
      existing: [{ componentType: 'Frame', brand: 'Moots', model: 'Vamoots' }]
    })
    expect(missing).toHaveLength(0)
  })

  it('ignores a changed removal date', () => {
    const missing = diffGearComponents({
      components: [
        { ...chain(Date.UTC(2020, 0, 1)), removedAt: Date.UTC(2022, 0, 1) }
      ],
      existing: [
        {
          componentType: 'Chain',
          brand: 'Shimano',
          model: 'CN-HG901-11',
          addedAt: Date.UTC(2020, 0, 1)
        }
      ]
    })
    expect(missing).toHaveLength(0)
  })

  it('compares names case-insensitively', () => {
    const missing = diffGearComponents({
      components: [{ type: 'chain', brand: 'shimano', model: 'cn-hg901-11' }],
      existing: [
        { componentType: 'Chain', brand: 'Shimano', model: 'CN-HG901-11' }
      ]
    })
    expect(missing).toHaveLength(0)
  })
})
