import {
  MAX_GALLERY_HIDDEN_LOCATIONS,
  isInGalleryHiddenLocation,
  parseGalleryHiddenLocations
} from '@/lib/services/gallery/hiddenLocations'

describe('parseGalleryHiddenLocations', () => {
  it.each([
    { description: 'a non-array', value: 'home', expected: [] },
    { description: 'null', value: null, expected: [] },
    {
      description: 'entries that are not objects',
      value: [1, 'x', null],
      expected: []
    },
    {
      description: 'an out-of-range latitude',
      value: [{ latitude: 91, longitude: 0, hideRadiusMeters: 100 }],
      expected: []
    },
    {
      description: 'a zero radius',
      value: [{ latitude: 1, longitude: 2, hideRadiusMeters: 0 }],
      expected: []
    },
    {
      description: 'a radius between options, snapped up',
      value: [{ latitude: 1, longitude: 2, hideRadiusMeters: 120 }],
      expected: [{ latitude: 1, longitude: 2, hideRadiusMeters: 200 }]
    },
    {
      description: 'a radius over the largest option, capped',
      value: [{ latitude: 1, longitude: 2, hideRadiusMeters: 5000 }],
      expected: [{ latitude: 1, longitude: 2, hideRadiusMeters: 1000 }]
    },
    {
      description: 'duplicates, collapsed',
      value: [
        { latitude: 1, longitude: 2, hideRadiusMeters: 100 },
        { latitude: 1, longitude: 2, hideRadiusMeters: 100 }
      ],
      expected: [{ latitude: 1, longitude: 2, hideRadiusMeters: 100 }]
    },
    {
      description: 'extra keys, dropped',
      value: [
        { latitude: 1, longitude: 2, hideRadiusMeters: 50, name: 'Home' }
      ],
      expected: [{ latitude: 1, longitude: 2, hideRadiusMeters: 50 }]
    }
  ])('handles $description', ({ value, expected }) => {
    expect(parseGalleryHiddenLocations(value)).toEqual(expected)
  })

  it('caps the list', () => {
    const value = Array.from(
      { length: MAX_GALLERY_HIDDEN_LOCATIONS + 5 },
      (_, index) => ({ latitude: index, longitude: 0, hideRadiusMeters: 100 })
    )

    expect(parseGalleryHiddenLocations(value)).toHaveLength(
      MAX_GALLERY_HIDDEN_LOCATIONS
    )
  })
})

describe('isInGalleryHiddenLocation', () => {
  const zone = {
    latitude: 51.5,
    longitude: -0.1,
    hideRadiusMeters: 200 as const
  }

  it.each([
    {
      description: 'the centre',
      latitude: 51.5,
      longitude: -0.1,
      inside: true
    },
    // ~111 m north.
    {
      description: 'a point inside the radius',
      latitude: 51.501,
      longitude: -0.1,
      inside: true
    },
    // ~334 m north.
    {
      description: 'a point outside the radius',
      latitude: 51.503,
      longitude: -0.1,
      inside: false
    }
  ])('answers $inside for $description', ({ latitude, longitude, inside }) => {
    expect(isInGalleryHiddenLocation(latitude, longitude, [zone])).toBe(inside)
  })

  it('is false with no zones', () => {
    expect(isInGalleryHiddenLocation(51.5, -0.1, [])).toBeFalse()
  })
})
