import {
  CreateGearComponentRequest,
  CreateGearRequest,
  UpdateFitnessFileGearRequest,
  UpdateGearComponentRequest,
  UpdateGearRequest,
  getGearKindFieldError
} from '@/lib/services/fitness-gears/gearRequests'

// The end of the range `new Date()` can represent.
const MAX_EPOCH_MILLISECONDS = 8_640_000_000_000_000

describe('UpdateGearRequest', () => {
  // The update paths decide what to write from key PRESENCE, so a schema that
  // materialises absent optional fields would clear every column the caller
  // never mentioned. This is the guard for that.
  it('omits optional fields the body does not mention', () => {
    const parsed = UpdateGearRequest.safeParse({ name: 'Renamed' })

    expect(parsed.success).toBe(true)
    expect(Object.keys(parsed.data ?? {})).toEqual(['name'])
    expect('brand' in (parsed.data ?? {})).toBe(false)
    expect('notes' in (parsed.data ?? {})).toBe(false)
    expect('alertDistanceMeters' in (parsed.data ?? {})).toBe(false)
  })

  it.each([
    { description: 'an explicit null', input: null },
    { description: 'an empty string', input: '' },
    { description: 'a whitespace-only string', input: '   ' }
  ])('treats $description as a clear', ({ input }) => {
    const parsed = UpdateGearRequest.safeParse({ brand: input })

    expect(parsed.success).toBe(true)
    expect('brand' in (parsed.data ?? {})).toBe(true)
    expect(parsed.data?.brand).toBeNull()
  })

  it('trims a supplied value', () => {
    const parsed = UpdateGearRequest.safeParse({ brand: '  Brompton  ' })
    expect(parsed.data?.brand).toBe('Brompton')
  })

  it('rejects a value longer than the column', () => {
    const parsed = UpdateGearRequest.safeParse({ brand: 'x'.repeat(256) })
    expect(parsed.success).toBe(false)
  })

  describe('productUrl', () => {
    it('leaves an unmentioned product page absent, not null', () => {
      const parsed = UpdateGearRequest.safeParse({ name: 'Edge 840' })
      expect(parsed.success).toBe(true)
      expect('productUrl' in (parsed.data ?? {})).toBe(false)
    })

    it.each([
      { description: 'an explicit null', input: null },
      { description: 'an empty string', input: '' },
      { description: 'a whitespace-only string', input: '   ' }
    ])('treats $description as a clear', ({ input }) => {
      const parsed = UpdateGearRequest.safeParse({ productUrl: input })
      expect(parsed.success).toBe(true)
      expect('productUrl' in (parsed.data ?? {})).toBe(true)
      expect(parsed.data?.productUrl).toBeNull()
    })

    it.each([
      {
        description: 'an https URL',
        input: 'https://www.garmin.com/en-US/p/781308'
      },
      { description: 'an http URL', input: 'http://example.com/device' }
    ])('accepts $description', ({ input }) => {
      const parsed = UpdateGearRequest.safeParse({ productUrl: input })
      expect(parsed.success).toBe(true)
      expect(parsed.data?.productUrl).toBe(input)
    })

    it('trims a supplied URL', () => {
      const parsed = UpdateGearRequest.safeParse({
        productUrl: '  https://www.coros.com  '
      })
      expect(parsed.data?.productUrl).toBe('https://www.coros.com')
    })

    it.each([
      {
        description: 'a javascript: URL',
        input: 'javascript:alert(1)'
      },
      { description: 'a data: URL', input: 'data:text/html,<script></script>' },
      // Rendered as a relative link on this origin rather than the vendor's.
      { description: 'a bare hostname', input: 'garmin.com' },
      {
        description: 'a URL longer than the column',
        input: `https://a.co/${'x'.repeat(255)}`
      }
    ])('rejects $description', ({ input }) => {
      expect(UpdateGearRequest.safeParse({ productUrl: input }).success).toBe(
        false
      )
    })
  })
})

describe('UpdateGearComponentRequest', () => {
  it('omits optional fields the body does not mention', () => {
    const parsed = UpdateGearComponentRequest.safeParse({
      componentType: 'Chain'
    })

    expect(parsed.success).toBe(true)
    expect(Object.keys(parsed.data ?? {})).toEqual(['componentType'])
  })

  it('rejects a removal date that precedes the added date', () => {
    const parsed = UpdateGearComponentRequest.safeParse({
      addedAt: 1_700_000_000_000,
      removedAt: 1_600_000_000_000
    })
    expect(parsed.success).toBe(false)
  })

  it('accepts a removal date after the added date', () => {
    const parsed = UpdateGearComponentRequest.safeParse({
      addedAt: 1_600_000_000_000,
      removedAt: 1_700_000_000_000
    })
    expect(parsed.success).toBe(true)
  })
})

describe('epoch-millisecond fields', () => {
  // `new Date(n)` is Invalid beyond ±8.64e15, and `.int()` alone allows values
  // a thousand times larger. An Invalid Date throws on PostgreSQL (a 500 for
  // what is plainly bad input) and stores as NULL on SQLite, where a null
  // `addedAt` means "installed since the gear's beginning".
  it.each([
    {
      description: 'a timestamp past the end of the Date range',
      value: MAX_EPOCH_MILLISECONDS + 1
    },
    {
      description: 'Number.MAX_SAFE_INTEGER',
      value: Number.MAX_SAFE_INTEGER
    }
  ])('rejects $description', ({ value }) => {
    expect(
      CreateGearComponentRequest.safeParse({
        componentType: 'Chain',
        addedAt: value
      }).success
    ).toBe(false)
    expect(
      UpdateGearComponentRequest.safeParse({ removedAt: value }).success
    ).toBe(false)
  })

  it('accepts the last instant a Date can hold', () => {
    const parsed = CreateGearComponentRequest.safeParse({
      componentType: 'Chain',
      addedAt: MAX_EPOCH_MILLISECONDS
    })

    expect(parsed.success).toBe(true)
    expect(new Date(parsed.data?.addedAt as number).getTime()).not.toBeNaN()
  })
})

describe('UpdateFitnessFileGearRequest', () => {
  // `setFitnessFileGear` skips its "is this gear mine?" lookup for a falsy
  // gearId, so an empty string that reached it would be written unchecked —
  // and `assignFitnessFileGearIfUnset`'s `whereNull('gearId')` guard means the
  // activity could then never be auto-assigned again.
  it.each([
    { description: 'an explicit null', input: null },
    { description: 'an empty string', input: '' },
    { description: 'a whitespace-only string', input: '   ' }
  ])('normalizes $description to a cleared attribution', ({ input }) => {
    const parsed = UpdateFitnessFileGearRequest.safeParse({ gearId: input })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.gearId).toBeNull()
  })

  it('keeps a supplied gear id, trimmed', () => {
    const parsed = UpdateFitnessFileGearRequest.safeParse({
      gearId: '  gear-1  '
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.gearId).toBe('gear-1')
  })

  it.each([
    { description: 'a missing key', input: {} },
    {
      description: 'an id longer than the column',
      input: { gearId: 'x'.repeat(256) }
    },
    { description: 'a non-string id', input: { gearId: 42 } }
  ])('rejects $description', ({ input }) => {
    expect(UpdateFitnessFileGearRequest.safeParse(input).success).toBe(false)
  })
})

describe('CreateGearRequest', () => {
  it('defaults an unspecified sport list to absent rather than null', () => {
    const parsed = CreateGearRequest.safeParse({ kind: 'bike', name: 'Moots' })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.defaultSports).toBeUndefined()
  })

  it.each([
    { description: 'an unknown sport key', defaultSports: ['skiing'] },
    { description: 'a misspelt sport key', defaultSports: ['Ride'] }
  ])('rejects $description', ({ defaultSports }) => {
    const parsed = CreateGearRequest.safeParse({
      kind: 'bike',
      name: 'Moots',
      defaultSports
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an empty name', () => {
    expect(
      CreateGearRequest.safeParse({ kind: 'bike', name: '   ' }).success
    ).toBe(false)
  })

  it('accepts a product page on a new bike', () => {
    const parsed = CreateGearRequest.safeParse({
      kind: 'bike',
      name: 'Moots',
      productUrl: '  https://moots.com/pages/vamoots-rsl  '
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.productUrl).toBe('https://moots.com/pages/vamoots-rsl')
  })

  it('leaves an unmentioned product page absent, not null', () => {
    const parsed = CreateGearRequest.safeParse({ kind: 'bike', name: 'Moots' })
    expect(parsed.success).toBe(true)
    expect('productUrl' in (parsed.data ?? {})).toBe(false)
  })

  it('rejects a product page that is not an http(s) URL', () => {
    expect(
      CreateGearRequest.safeParse({
        kind: 'bike',
        name: 'Moots',
        productUrl: 'javascript:alert(1)'
      }).success
    ).toBe(false)
  })

  it.each([
    // Devices are created only by `resolveDeviceGear`, from the identity the
    // recorded file carried — one made by hand would match no upload.
    { description: 'a device', kind: 'device' },
    { description: 'a kind that does not exist', kind: 'skis' }
  ])('rejects $description', ({ kind }) => {
    expect(
      CreateGearRequest.safeParse({ kind, name: 'Edge 840' }).success
    ).toBe(false)
  })
})

describe('CreateGearComponentRequest', () => {
  it('requires a component type', () => {
    expect(CreateGearComponentRequest.safeParse({}).success).toBe(false)
  })

  it('accepts a component installed since the gear’s beginning', () => {
    const parsed = CreateGearComponentRequest.safeParse({
      componentType: 'Frame'
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.addedAt).toBeUndefined()
  })
})

describe('getGearKindFieldError', () => {
  it.each([
    {
      description: 'a bike given a shoes distance alert',
      kind: 'bike' as const,
      fields: { alertDistanceMeters: 650_000 }
    },
    {
      description: 'shoes given a frame type',
      kind: 'shoes' as const,
      fields: { bikeType: 'Road bike' }
    },
    {
      description: 'shoes given a weight',
      kind: 'shoes' as const,
      fields: { weightKilograms: 0.3 }
    },
    {
      description: 'a bike claiming a running sport',
      kind: 'bike' as const,
      fields: { defaultSports: ['run' as const] }
    },
    {
      description: 'shoes claiming a cycling sport',
      kind: 'shoes' as const,
      fields: { defaultSports: ['gravel_ride' as const] }
    },
    {
      description: 'a device given a frame type',
      kind: 'device' as const,
      fields: { bikeType: 'Road bike' }
    },
    {
      description: 'a device given a weight',
      kind: 'device' as const,
      fields: { weightKilograms: 0.1 }
    },
    {
      description: 'a device given a distance alert',
      kind: 'device' as const,
      fields: { alertDistanceMeters: 650_000 }
    },
    {
      // A device records rides and runs alike; claiming a sport would take it
      // off the bike or shoes that should hold it.
      description: 'a device claiming a sport',
      kind: 'device' as const,
      fields: { defaultSports: ['ride' as const] }
    }
  ])('reports an error for $description', ({ kind, fields }) => {
    expect(getGearKindFieldError(kind, fields)).toEqual(expect.any(String))
  })

  it.each([
    {
      description: 'a bike with bike fields and bike sports',
      kind: 'bike' as const,
      fields: {
        bikeType: 'Road bike',
        weightKilograms: 8.1,
        defaultSports: ['ride' as const, 'gravel_ride' as const]
      }
    },
    {
      description: 'shoes with an alert and shoe sports',
      kind: 'shoes' as const,
      fields: {
        alertDistanceMeters: 650_000,
        defaultSports: ['run' as const, 'hike' as const]
      }
    },
    {
      description: 'gear with nothing set',
      kind: 'bike' as const,
      fields: {}
    },
    {
      description: 'shoes explicitly clearing bike-only fields',
      kind: 'shoes' as const,
      fields: { bikeType: null, weightKilograms: null }
    },
    {
      description: 'a device with a product page and an empty sport list',
      kind: 'device' as const,
      fields: { productUrl: 'https://www.garmin.com', defaultSports: [] }
    },
    {
      description: 'a device clearing its product page',
      kind: 'device' as const,
      fields: { productUrl: null }
    },
    {
      description: 'a bike explicitly clearing a product page it never had',
      kind: 'bike' as const,
      fields: { productUrl: null }
    },
    {
      // Every kind has a manufacturer's page worth linking to, so the product
      // page is the one field a bike, a pair of shoes and a device all share.
      description: 'a bike given a product page',
      kind: 'bike' as const,
      fields: { productUrl: 'https://moots.com/pages/vamoots-rsl' }
    },
    {
      description: 'shoes given a product page',
      kind: 'shoes' as const,
      fields: { productUrl: 'https://www.hoka.com' }
    }
  ])('accepts $description', ({ kind, fields }) => {
    expect(getGearKindFieldError(kind, fields)).toBeNull()
  })
})
