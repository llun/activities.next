import exifr from 'exifr'

import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/**
 * The EXIF fields an upload is described by. Every field is `null` when the
 * file does not carry it, when it is unusable, or when the file could not be
 * read at all.
 */
export interface MediaExif {
  /** `DateTimeOriginal`, with `OffsetTimeOriginal` applied when present. */
  takenAt: Date | null
  make: string | null
  model: string | null
  lensModel: string | null
  focalLengthMm: number | null
  /** The f-number: 2.8 for f/2.8. */
  aperture: number | null
  /** Display form, as a photographer reads it: "1/2000", "0.4", "30". */
  exposureTime: string | null
  iso: number | null
  /** Decimal degrees, WGS 84. */
  latitude: number | null
  longitude: number | null
}

export const EMPTY_MEDIA_EXIF: MediaExif = {
  takenAt: null,
  make: null,
  model: null,
  lensModel: null,
  focalLengthMm: null,
  aperture: null,
  exposureTime: null,
  iso: null,
  latitude: null,
  longitude: null
}

// `make`, `model` and `lensModel` end up in varchar(255) columns.
const TEXT_MAX = 255

const EXIF_PICK = [
  'Make',
  'Model',
  'LensModel',
  'DateTimeOriginal',
  'OffsetTimeOriginal',
  'FocalLength',
  'FNumber',
  'ExposureTime',
  'ISO',
  'GPSLatitude',
  'GPSLongitude',
  'GPSLatitudeRef',
  'GPSLongitudeRef'
]

const toText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  // Cameras pad ASCII fields with NULs and spaces.
  const text = value.split('\0').join('').trim()
  return text ? text.slice(0, TEXT_MAX).trim() : null
}

const toPositiveNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null

/**
 * Shutter speed the way a camera shows it. Fast speeds are a reciprocal
 * ("1/2000"); a reciprocal that is not close to the real value (0.4 s is not
 * 1/3) falls back to the decimal, and a second or longer is a decimal anyway.
 */
export const formatExposureTime = (seconds: unknown): string | null => {
  const value = toPositiveNumber(seconds)
  if (value === null) return null

  if (value < 1) {
    const denominator = Math.round(1 / value)
    if (denominator > 1 && Math.abs(1 / denominator - value) / value < 0.05) {
      return `1/${denominator}`
    }
    return String(Number(value.toFixed(2)))
  }
  return String(Number(value.toFixed(1)))
}

// Cameras with an unset clock write "0000:00:00 00:00:00" (which a Date turns
// into 1899-11-30) or a tiny year (the Date constructor maps years 1-99 into
// 1901-1999); a clock set wrong can also land in the future. None of those is
// a real taken time, so they read as missing. The floor is 1990, before
// digital cameras wrote EXIF, which also catches most of the 1901-1999 range
// those tiny years land in.
const MIN_PLAUSIBLE_YEAR = 1990
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

const OFFSET_PATTERN = /^([+-])(\d{2}):(\d{2})$/

// exifr revives `DateTimeOriginal` with `new Date(y, m, d, h, mi, s)`, i.e. in
// the PROCESS's local timezone, whatever zone the camera was in. The wall-clock
// fields it read are exactly the local fields of the Date it hands back, so
// they are read back out and rebuilt as UTC: the result no longer depends on
// the server's TZ.
export const toTakenAt = (value: unknown, offset: unknown): Date | null => {
  if (!(value instanceof Date)) return null
  if (!Number.isFinite(value.getTime())) return null

  const wallClock = Date.UTC(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    value.getHours(),
    value.getMinutes(),
    value.getSeconds()
  )

  // When the file also records the UTC offset that wall-clock was in,
  // subtracting it yields the real instant; without one the wall-clock reading
  // (as UTC) is the best we have.
  const match = typeof offset === 'string' ? OFFSET_PATTERN.exec(offset) : null
  const offsetMinutes = match
    ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
    : 0
  const takenAt = new Date(wallClock - offsetMinutes * 60_000)

  if (new Date(wallClock).getUTCFullYear() < MIN_PLAUSIBLE_YEAR) return null
  if (takenAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) return null
  return takenAt
}

// `0,0` is what a camera writes when it has no fix, and no bird was ever
// photographed from Null Island.
const toCoordinates = (
  latitude: unknown,
  longitude: unknown
): { latitude: number; longitude: number } | null => {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  if (latitude === 0 && longitude === 0) return null
  return { latitude, longitude }
}

/**
 * Reads the EXIF a camera wrote, from the ORIGINAL upload bytes.
 *
 * It has to run before the re-encode: the stored image is produced without
 * `keepExif()` because EXIF carries GPS position and device identifiers and the
 * stored file is public, so once the pipeline has run the data is gone. What is
 * read here is therefore the only copy — and what leaves the server of it is
 * decided by the media's `placePrecision` and the owner's `showGear`, never by
 * the file.
 *
 * Never throws. A file with no EXIF, a format exifr cannot read and a corrupt
 * block all return the empty result: details are decoration on an upload that
 * has already been accepted, and losing them must not fail it.
 */
export const readMediaExif = async (input: Buffer): Promise<MediaExif> => {
  try {
    const tags = (await exifr.parse(input, {
      pick: EXIF_PICK,
      gps: true,
      tiff: true,
      exif: true,
      xmp: false,
      icc: false,
      iptc: false,
      jfif: false,
      ihdr: false
    })) as Record<string, unknown> | undefined
    if (!tags) return { ...EMPTY_MEDIA_EXIF }

    const coordinates = toCoordinates(tags.latitude, tags.longitude)

    return {
      takenAt: toTakenAt(tags.DateTimeOriginal, tags.OffsetTimeOriginal),
      make: toText(tags.Make),
      model: toText(tags.Model),
      lensModel: toText(tags.LensModel),
      focalLengthMm: toPositiveNumber(tags.FocalLength),
      aperture: toPositiveNumber(tags.FNumber),
      exposureTime: formatExposureTime(tags.ExposureTime),
      iso: toPositiveNumber(tags.ISO),
      latitude: coordinates?.latitude ?? null,
      longitude: coordinates?.longitude ?? null
    }
  } catch (error) {
    logger.debug({
      message: 'Could not read EXIF from an uploaded media file',
      err: toLoggableError(error)
    })
    return { ...EMPTY_MEDIA_EXIF }
  }
}
