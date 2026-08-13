import { describe, expect, it } from 'vitest'

import {
  buildDeviceGearSeed,
  getDeviceGearKey
} from '@/lib/services/fitness-gears/deviceIdentity'

describe('getDeviceGearKey', () => {
  it.each([
    {
      description: 'prefers the device name over the manufacturer',
      deviceName: 'Garmin Edge 840',
      deviceManufacturer: 'garmin',
      expected: 'name:garmin edge 840'
    },
    {
      description:
        'produces the same key for the Strava spelling with no manufacturer',
      deviceName: 'Garmin Edge 840',
      deviceManufacturer: null,
      expected: 'name:garmin edge 840'
    },
    {
      description: 'collapses whitespace and case',
      deviceName: '  Garmin   EDGE  840 ',
      deviceManufacturer: null,
      expected: 'name:garmin edge 840'
    },
    {
      description: 'falls back to a recognised manufacturer with no name',
      deviceName: null,
      deviceManufacturer: 'wahoo_fitness',
      expected: 'mfr:wahoo_fitness'
    },
    {
      description:
        'falls back to the manufacturer when the name is a bare FIT code',
      deviceName: '4315',
      deviceManufacturer: 'garmin',
      expected: 'mfr:garmin'
    },
    {
      description: 'keys a device the brand map does not know by its own name',
      deviceName: 'Strava iPhone App',
      deviceManufacturer: null,
      expected: 'name:strava iphone app'
    },
    {
      description: 'returns null for an unrecognised numeric manufacturer',
      deviceName: null,
      deviceManufacturer: '65535',
      expected: null
    },
    {
      description: 'returns null when both fields are a bare FIT code',
      deviceName: '4315',
      deviceManufacturer: '65535',
      expected: null
    },
    {
      description: 'returns null when nothing was recorded',
      deviceName: null,
      deviceManufacturer: null,
      expected: null
    },
    {
      description: 'returns null for a whitespace-only device name',
      deviceName: '   ',
      deviceManufacturer: null,
      expected: null
    }
  ])('$description', ({ deviceName, deviceManufacturer, expected }) => {
    expect(getDeviceGearKey(deviceName, deviceManufacturer)).toEqual(expected)
  })

  it('caps the key at the deviceKey column width with no trailing space', () => {
    const key = getDeviceGearKey(`Garmin ${'a'.repeat(300)} x`, 'garmin')
    expect(key).not.toBeNull()
    expect((key as string).length).toBeLessThanOrEqual(255)
    expect(key).toBe((key as string).trimEnd())
  })

  it('resolves a numeric manufacturer the FIT brand map recognises', () => {
    // 267 is Bryton's FIT manufacturer code. The parser normally rewrites a
    // recognised code to its string key before storing, so this only covers a
    // row written before that normalization — a known brand still gets a row
    // rather than being discarded as "just a number".
    expect(getDeviceGearKey(null, '267')).toBe('mfr:bryton')
  })
})

describe('buildDeviceGearSeed', () => {
  it.each([
    {
      description: 'splits a branded FIT device name into brand and model',
      deviceName: 'Garmin Edge 840',
      deviceManufacturer: 'garmin',
      expected: {
        deviceKey: 'name:garmin edge 840',
        name: 'Garmin Edge 840',
        brand: 'Garmin',
        model: 'Edge 840',
        productUrl: 'https://www.garmin.com'
      }
    },
    {
      description: 'derives the brand from the name when Strava sends none',
      deviceName: 'Wahoo ELEMNT BOLT',
      deviceManufacturer: null,
      expected: {
        deviceKey: 'name:wahoo elemnt bolt',
        name: 'Wahoo ELEMNT BOLT',
        brand: 'Wahoo',
        model: 'ELEMNT BOLT',
        productUrl: 'https://www.wahoofitness.com'
      }
    },
    {
      description: 'names a manufacturer-only device after the brand',
      deviceName: null,
      deviceManufacturer: 'coros',
      expected: {
        deviceKey: 'mfr:coros',
        name: 'Coros',
        brand: 'Coros',
        // Nothing is left after the brand prefix, and an empty model is not a
        // model.
        model: null,
        productUrl: 'https://www.coros.com'
      }
    },
    {
      description: 'leaves an unknown brand without a product page',
      deviceName: 'Strava iPhone App',
      deviceManufacturer: null,
      expected: {
        deviceKey: 'name:strava iphone app',
        name: 'Strava iPhone App',
        brand: null,
        model: null,
        productUrl: null
      }
    }
  ])('$description', ({ deviceName, deviceManufacturer, expected }) => {
    expect(buildDeviceGearSeed(deviceName, deviceManufacturer)).toEqual(
      expected
    )
  })

  it('returns null when there is no device identity to seed a row from', () => {
    expect(buildDeviceGearSeed(null, null)).toBeNull()
    expect(buildDeviceGearSeed('', '65535')).toBeNull()
  })

  it('caps every seeded field at the column width', () => {
    const seed = buildDeviceGearSeed(`Garmin ${'b'.repeat(400)}`, 'garmin')
    expect(seed).not.toBeNull()
    expect(
      (seed as { deviceKey: string }).deviceKey.length
    ).toBeLessThanOrEqual(255)
    expect((seed as { name: string }).name.length).toBeLessThanOrEqual(255)
  })
})
