import {
  BIKE_TYPE_OPTIONS,
  COMPONENT_TYPE_OPTIONS,
  formatGearDate,
  formatGearDistanceKm,
  formatKmInt,
  formatWeightKg,
  getGearDisplayName,
  getWearState
} from './gearUi'

describe('formatGearDistanceKm', () => {
  it.each([
    {
      description: 'renders a five-digit total with a thousands separator',
      meters: 35253700,
      expected: '35,253.7 km'
    },
    {
      description: 'always keeps one decimal place',
      meters: 12000,
      expected: '12.0 km'
    },
    {
      description: 'renders zero distance',
      meters: 0,
      expected: '0.0 km'
    },
    {
      description: 'rounds to a single decimal',
      meters: 1249,
      expected: '1.2 km'
    }
  ])('$description', ({ meters, expected }) => {
    expect(formatGearDistanceKm(meters)).toEqual(expected)
  })
})

describe('formatKmInt', () => {
  it.each([
    {
      description: 'renders a service interval',
      meters: 5000000,
      expected: '5,000 km'
    },
    { description: 'drops the decimals', meters: 650000, expected: '650 km' },
    {
      description: 'rounds to whole kilometres',
      meters: 1500,
      expected: '2 km'
    }
  ])('$description', ({ meters, expected }) => {
    expect(formatKmInt(meters)).toEqual(expected)
  })
})

describe('formatWeightKg', () => {
  it.each([
    {
      description: 'renders a fractional weight',
      kilograms: 8.1,
      expected: '8.1 kg'
    },
    { description: 'pads a whole weight', kilograms: 9, expected: '9.0 kg' }
  ])('$description', ({ kilograms, expected }) => {
    expect(formatWeightKg(kilograms)).toEqual(expected)
  })
})

describe('formatGearDate', () => {
  it('renders a medium US date', () => {
    expect(formatGearDate(Date.UTC(2018, 10, 27, 12))).toEqual('Nov 27, 2018')
  })

  it('renders every instant of a UTC day as that day, whatever the runner zone', () => {
    // `<input type="date">` yields "2024-03-01", which the spec parses as UTC
    // midnight: formatted in local time that is "Feb 29, 2024" in Los Angeles.
    // The end of the same UTC day is the mirror failure in Tokyo.
    const startOfDay = Date.parse('2024-03-01T00:00:00Z')
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1

    expect(formatGearDate(startOfDay)).toEqual('Mar 1, 2024')
    expect(formatGearDate(endOfDay)).toEqual('Mar 1, 2024')
  })
})

describe('getGearDisplayName', () => {
  it.each([
    {
      description: 'uses the stored name',
      gear: {
        kind: 'bike' as const,
        name: 'Rocket',
        brand: 'Canyon',
        model: 'Endurace'
      },
      expected: 'Rocket'
    },
    {
      description: 'falls back to brand and model',
      gear: {
        kind: 'bike' as const,
        name: '   ',
        brand: 'Canyon',
        model: 'Endurace'
      },
      expected: 'Canyon Endurace'
    },
    {
      description: 'falls back to brand alone',
      gear: {
        kind: 'shoes' as const,
        name: '',
        brand: 'Hoka',
        model: null
      },
      expected: 'Hoka'
    },
    {
      description: 'falls back to the bike kind label',
      gear: { kind: 'bike' as const, name: '', brand: null, model: null },
      expected: 'Bike'
    },
    {
      description: 'falls back to the shoes kind label',
      gear: { kind: 'shoes' as const, name: '', brand: null, model: null },
      expected: 'Shoes'
    }
  ])('$description', ({ gear, expected }) => {
    expect(getGearDisplayName(gear)).toEqual(expected)
  })
})

describe('getWearState', () => {
  it.each([
    {
      description: 'returns null without a service interval',
      distanceMeters: 1000000,
      serviceDistanceMeters: null
    },
    {
      description: 'returns null for a zero service interval',
      distanceMeters: 1000000,
      serviceDistanceMeters: 0
    },
    {
      description: 'returns null for an undefined service interval',
      distanceMeters: 1000000,
      serviceDistanceMeters: undefined
    }
  ])('$description', ({ distanceMeters, serviceDistanceMeters }) => {
    expect(getWearState(distanceMeters, serviceDistanceMeters)).toBeNull()
  })

  it.each([
    {
      description: 'stays ok just below the 85% boundary',
      distanceMeters: 4249000,
      serviceDistanceMeters: 5000000,
      level: 'ok',
      barClassName: 'bg-primary',
      caption: 'of 5,000 km',
      captionClassName: 'text-muted-foreground'
    },
    {
      description: 'is due soon exactly at 85%',
      distanceMeters: 4250000,
      serviceDistanceMeters: 5000000,
      level: 'due-soon',
      barClassName: 'bg-amber-500',
      caption: 'due soon',
      captionClassName: 'text-amber-600 dark:text-amber-500'
    },
    {
      description: 'is still due soon just below 100%',
      distanceMeters: 4999000,
      serviceDistanceMeters: 5000000,
      level: 'due-soon',
      barClassName: 'bg-amber-500',
      caption: 'due soon',
      captionClassName: 'text-amber-600 dark:text-amber-500'
    },
    {
      description: 'is overdue exactly at 100%',
      distanceMeters: 5000000,
      serviceDistanceMeters: 5000000,
      level: 'overdue',
      barClassName: 'bg-destructive',
      caption: 'replace due',
      captionClassName: 'text-destructive'
    },
    {
      description: 'is overdue beyond the interval',
      distanceMeters: 9000000,
      serviceDistanceMeters: 5000000,
      level: 'overdue',
      barClassName: 'bg-destructive',
      caption: 'replace due',
      captionClassName: 'text-destructive'
    }
  ])(
    '$description',
    ({
      distanceMeters,
      serviceDistanceMeters,
      level,
      barClassName,
      caption,
      captionClassName
    }) => {
      const state = getWearState(distanceMeters, serviceDistanceMeters)
      expect(state).not.toBeNull()
      expect(state?.level).toEqual(level)
      expect(state?.barClassName).toEqual(barClassName)
      expect(state?.caption).toEqual(caption)
      expect(state?.captionClassName).toEqual(captionClassName)
    }
  )

  it('caps the bar width at 100% while reporting the real percentage', () => {
    const state = getWearState(9000000, 5000000)
    expect(state?.barWidth).toEqual('100%')
    // `barPercent` is what `aria-valuenow` reports, so it is capped too.
    expect(state?.barPercent).toEqual(100)
    expect(state?.percent).toEqual(180)
  })

  it('reports the uncapped bar width below the interval', () => {
    const state = getWearState(2500000, 5000000)
    expect(state?.barWidth).toEqual('50%')
    expect(state?.barPercent).toEqual(50)
    expect(state?.percent).toEqual(50)
  })
})

describe('gear option lists', () => {
  it('offers every bike type the design system lists', () => {
    expect(BIKE_TYPE_OPTIONS).toEqual([
      'Road bike',
      'Gravel bike',
      'Mountain bike',
      'Folding bike',
      'Commuter',
      'E-bike',
      'Time trial'
    ])
  })

  it('offers the drivetrain, contact-point and suspension component types', () => {
    expect(COMPONENT_TYPE_OPTIONS).toContain('Chain')
    expect(COMPONENT_TYPE_OPTIONS).toContain('Bottom bracket')
    expect(COMPONENT_TYPE_OPTIONS).toContain('Rear shock')
    expect(COMPONENT_TYPE_OPTIONS).toHaveLength(19)
  })
})
