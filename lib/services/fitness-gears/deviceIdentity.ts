import {
  getBrandFromDeviceName,
  getBrandFromManufacturer,
  getDeviceDisplayLabel
} from '@/lib/utils/fitnessDeviceBrands'

/**
 * The identity half of a `kind: 'device'` gear row.
 *
 * A device row has two independent halves. `deviceKey` is the immutable
 * identity: it is derived only from what the recorded file said, it is unique
 * per actor, and it is what every later upload matches against. `name`, `brand`,
 * `model` and `productUrl` are display overrides the owner may rewrite at will —
 * which is exactly why they cannot be the key. Keying on the name would fork a
 * duplicate row the first time someone renamed "Garmin Edge 840" to "the Edge",
 * and the next ride would land on the new row while every earlier one stayed on
 * the old.
 *
 * `fitness_files.deviceName` / `deviceManufacturer` stay untouched as the
 * recorded facts. This module never reads a gear row and never writes one; it
 * only turns those two strings into the seed a row is created from.
 *
 * This module is deliberately free of `'use client'` and of any client import:
 * the import jobs, the backfill script and the API routes all read values out of
 * it (see AGENTS.md → Server/Client Module Boundary).
 */

// `deviceKey`, `name`, `brand`, `model` and `productUrl` are all varchar(255).
const VARCHAR_MAX = 255

// The `name:` prefix costs 5 characters of the 255 the column holds.
const DEVICE_KEY_PREFIX_NAME = 'name:'
const DEVICE_KEY_PREFIX_MANUFACTURER = 'mfr:'

/**
 * A device name that is only digits is a FIT manufacturer or product code the
 * parser could not resolve to a brand — `"267"`, not a device. Naming a gear row
 * after it would put a bare number in the shed, so such a value is treated as no
 * name at all. This mirrors the guard `getDeviceDisplayLabel` already applies
 * when deciding whether there is anything worth rendering.
 */
const isNumericOnly = (value: string): boolean => /^\d+$/.test(value)

/**
 * Collapses every run of whitespace to one space and lowercases, so
 * `"Garmin  Edge 840"`, `"garmin edge 840"` and `" Garmin Edge 840 "` are one
 * device rather than three. Case and spacing are the two ways the same head unit
 * spells its name across FIT, TCX and Strava.
 */
const normalizeDeviceName = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Cuts to the column width without leaving a trailing space behind — slice
 * first, then trim, the same order `truncateGearName` uses. Two devices whose
 * names differ only past 250 characters collapse into one row; that is the
 * accepted cost of a bounded key.
 */
const capToColumn = (value: string, max: number = VARCHAR_MAX): string =>
  value.length <= max ? value : value.slice(0, max).trim()

/**
 * The unique identity of the device that recorded an activity, or null when the
 * file says nothing usable and therefore no device row should exist.
 *
 * Preference order is deliberate: a usable device name is far more specific than
 * a manufacturer, so `("Garmin Edge 840", "garmin")` and
 * `("Garmin Edge 840", null)` — the FIT and Strava spellings of the same ride —
 * must produce the same key. Only when there is no usable name does a recognised
 * manufacturer stand in for one, which groups every unnamed Garmin upload onto a
 * single "Garmin" row rather than creating none.
 *
 * An unrecognised manufacturer with no usable name yields null. A raw FIT code
 * the parser could not resolve is not an identity worth a page, and
 * `getDeviceDisplayLabel` already refuses to render one. A free-text
 * manufacturer nobody recognises ("acme", with no device name) is the one case
 * where a label still renders while no row exists — the render sites fall back
 * to plain text there, which is exactly what they did before devices had rows.
 */
export const getDeviceGearKey = (
  deviceName?: string | null,
  deviceManufacturer?: string | null
): string | null => {
  const trimmedName = deviceName?.trim() ?? ''
  if (trimmedName && !isNumericOnly(trimmedName)) {
    return capToColumn(
      `${DEVICE_KEY_PREFIX_NAME}${normalizeDeviceName(trimmedName)}`
    )
  }

  const brand = getBrandFromManufacturer(deviceManufacturer)
  if (brand) {
    return capToColumn(`${DEVICE_KEY_PREFIX_MANUFACTURER}${brand.key}`)
  }

  return null
}

export interface DeviceGearSeed {
  deviceKey: string
  name: string
  brand: string | null
  model: string | null
  productUrl: string | null
}

/**
 * Strips a leading brand word from the device name so `"Garmin Edge 840"` stores
 * brand "Garmin" and model "Edge 840" rather than repeating the brand in both.
 * Returns null when the name is nothing but the brand ("Wahoo"), since an empty
 * model is not a model.
 */
const getModelFromName = (name: string, brandName: string): string | null => {
  const lowerName = name.toLowerCase()
  const lowerBrand = brandName.toLowerCase()
  if (!lowerName.startsWith(lowerBrand)) return null

  const remainder = name.slice(brandName.length).trim()
  return remainder || null
}

/**
 * The full seed a device row is created from, or null when the file carries no
 * device identity at all. Callers must treat null as "create nothing" rather
 * than as an error — most GPX files have no device information, and that is
 * normal rather than a failure.
 *
 * `productUrl` is seeded from the brand map so the manufacturer link the
 * activity page used to render inline moves onto the device row. It is the
 * brand's home page, not the product's, which is why the owner can replace it —
 * "Garmin Edge 840" deserves the Edge 840's page, and only a person knows it.
 */
export const buildDeviceGearSeed = (
  deviceName?: string | null,
  deviceManufacturer?: string | null
): DeviceGearSeed | null => {
  const deviceKey = getDeviceGearKey(deviceName, deviceManufacturer)
  if (!deviceKey) return null

  // The same resolution order `getDeviceDisplayLabel` uses, so the seeded name
  // and the label rendered for an activity with no row yet agree.
  const brandInfo =
    getBrandFromManufacturer(deviceManufacturer) ??
    getBrandFromDeviceName(deviceName)

  // Non-null by construction: a key exists only when there is a usable name or a
  // recognised brand, and `getDeviceDisplayLabel` returns one of those two.
  const label = getDeviceDisplayLabel(deviceName, deviceManufacturer)
  const name = capToColumn(label?.trim() || (brandInfo?.displayName ?? ''))

  return {
    deviceKey,
    name,
    brand: brandInfo ? capToColumn(brandInfo.displayName) : null,
    model: brandInfo
      ? getModelFromName(name, brandInfo.displayName)
      : // Without a recognised brand there is nothing to split the name on:
        // "Strava iPhone App" is a name, not a brand and a model.
        null,
    productUrl: brandInfo ? capToColumn(brandInfo.url) : null
  }
}
