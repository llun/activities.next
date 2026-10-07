import { Database } from '@/lib/database/types'
import { MAX_GALLERY_GEAR_PER_ACTOR } from '@/lib/services/gallery/galleryRequests'
import { MediaExif } from '@/lib/services/medias/exif/readMediaExif'
import { GalleryGearKind } from '@/lib/types/database/gallery'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

/**
 * The identity half of a camera or lens `gallery_gears` row, and the function
 * that resolves an upload's EXIF to one.
 *
 * It mirrors `resolveDeviceGear` for fitness devices, and the three invariants
 * are the same:
 *
 * 1. **It never mutates an existing row.** The name, brand, model and product
 *    page are the owner's to edit; the next upload from the same camera must
 *    not rewrite "my R5" back to "Canon EOS R5". Only the `deviceKey` is derived
 *    from the file, and it is create-only.
 * 2. **It is idempotent.** The lookup is by `deviceKey`, a pure function of the
 *    recorded fields, so a thousand photos from one body resolve to one row.
 * 3. **It returns null rather than throwing.** Gear is a nicety on an upload
 *    that has already been accepted.
 *
 * This module is free of `'use client'` and of any client import: the upload
 * services and the API routes both read values out of it.
 */

// `deviceKey`, `name`, `brand` and `model` are all varchar(255).
const VARCHAR_MAX = 255

const capToColumn = (value: string): string =>
  value.length <= VARCHAR_MAX ? value : value.slice(0, VARCHAR_MAX).trim()

/** Collapses whitespace runs and lowercases, so spelling variants are one key. */
const normalize = (value: string): string =>
  value.trim().replace(/\s+/g, ' ').toLowerCase()

// Corporate suffixes cameras put after the maker ("NIKON CORPORATION",
// "OLYMPUS IMAGING CORP.", "SONY") are noise in a display name.
const MAKE_SUFFIX_PATTERN =
  /\s+(?:corporation|corp\.?|co\.?,?\s*ltd\.?|company|imaging|inc\.?|ltd\.?|limited)\b.*$/i

const cleanMake = (make: string): string => {
  const stripped = make.replace(MAKE_SUFFIX_PATTERN, '').trim()
  const base = stripped || make.trim()
  // "NIKON" -> "Nikon", but leave short acronyms ("DJI") and mixed case alone.
  if (base.length > 3 && base === base.toUpperCase()) {
    return base.charAt(0) + base.slice(1).toLowerCase()
  }
  return base
}

export interface GalleryGearSeed {
  deviceKey: string
  name: string
  brand: string | null
  model: string | null
}

export const getCameraGearKey = (
  make?: string | null,
  model?: string | null
): string | null => {
  const normalizedMake = make?.trim() ? normalize(make) : ''
  const normalizedModel = model?.trim() ? normalize(model) : ''
  // A camera is identified by its model; a maker alone names no body.
  if (!normalizedModel) return null
  return capToColumn(`camera:${normalizedMake}|${normalizedModel}`)
}

export const getLensGearKey = (lensModel?: string | null): string | null => {
  if (!lensModel?.trim()) return null
  return capToColumn(`lens:${normalize(lensModel)}`)
}

export const buildCameraGearSeed = (
  make?: string | null,
  model?: string | null
): GalleryGearSeed | null => {
  const deviceKey = getCameraGearKey(make, model)
  if (!deviceKey) return null

  const trimmedModel = (model ?? '').trim()
  const brand = make?.trim() ? cleanMake(make) : null
  // "Canon" + "Canon EOS R5" is "Canon EOS R5", not "Canon Canon EOS R5".
  const name =
    brand && !trimmedModel.toLowerCase().startsWith(brand.toLowerCase())
      ? `${brand} ${trimmedModel}`
      : trimmedModel

  return {
    deviceKey,
    name: capToColumn(name),
    brand: brand ? capToColumn(brand) : null,
    model: capToColumn(
      brand && trimmedModel.toLowerCase().startsWith(brand.toLowerCase())
        ? trimmedModel.slice(brand.length).trim() || trimmedModel
        : trimmedModel
    )
  }
}

export const buildLensGearSeed = (
  lensModel?: string | null
): GalleryGearSeed | null => {
  const deviceKey = getLensGearKey(lensModel)
  if (!deviceKey || !lensModel) return null

  const name = capToColumn(lensModel.trim())
  return { deviceKey, name, brand: null, model: name }
}

/**
 * Finds — or creates — the camera or lens row a seed describes. Returns null
 * for no seed, and on any failure (logged), never throwing.
 */
export const resolveGalleryGear = async ({
  database,
  actorId,
  kind,
  seed
}: {
  database: Database
  actorId: string
  kind: GalleryGearKind
  seed: GalleryGearSeed | null
}): Promise<{ id: string } | null> => {
  if (!seed) return null

  try {
    const existing = await database.findGalleryGearByDeviceKey({
      actorId,
      deviceKey: seed.deviceKey
    })
    if (existing) return { id: existing.id }
  } catch (error) {
    logger.warn({
      message: 'Failed to look up the gallery gear for an upload',
      actorId,
      deviceKey: seed.deviceKey,
      err: toLoggableError(error)
    })
    return null
  }

  try {
    // The key comes from client-controlled EXIF strings, so a new key per
    // upload is cheap to forge: creation honours the same per-actor cap as
    // `POST /api/v1/gallery/gears`. At the cap the photo simply gets no gear
    // link — it is a nicety, and the upload stands.
    const result = await database.createGalleryGearWithinLimit({
      actorId,
      kind,
      name: seed.name,
      brand: seed.brand,
      model: seed.model,
      deviceKey: seed.deviceKey,
      limit: MAX_GALLERY_GEAR_PER_ACTOR
    })
    if (result.status === 'limit-reached') {
      logger.info({
        message: 'Skipped creating gallery gear for an upload at the gear cap',
        actorId,
        deviceKey: seed.deviceKey
      })
      return null
    }
    return { id: result.gear.id }
  } catch (error) {
    // `(actorId, deviceKey)` is UNIQUE and the index covers soft-deleted rows
    // too, while the lookup ignores them. That is coherent only because
    // deleting a gear row MUST null its `deviceKey` in the same update that
    // sets `deletedAt` (as `fitnessGear.ts` does); a deleted camera then
    // releases its key and the next upload creates a fresh row. Otherwise the
    // insert would hit the unique violation, the re-read below would miss the
    // deleted row, and the photo would silently lose its gear for good.
    //
    // `(actorId, deviceKey)` is UNIQUE, and two photos from one camera uploaded
    // in parallel race here. Whoever loses re-reads the row the winner inserted
    // rather than dropping the link for that photo.
    const winner = await database
      .findGalleryGearByDeviceKey({ actorId, deviceKey: seed.deviceKey })
      .catch(() => null)
    if (winner) return { id: winner.id }

    logger.warn({
      message: 'Failed to create the gallery gear for an upload',
      actorId,
      deviceKey: seed.deviceKey,
      err: toLoggableError(error)
    })
    return null
  }
}

/** The camera and lens rows an upload's EXIF resolves to. */
export const resolveGalleryGearFromExif = async ({
  database,
  actorId,
  exif
}: {
  database: Database
  actorId: string
  exif: Pick<MediaExif, 'make' | 'model' | 'lensModel'>
}): Promise<{ cameraGearId: string | null; lensGearId: string | null }> => {
  const [camera, lens] = await Promise.all([
    resolveGalleryGear({
      database,
      actorId,
      kind: 'camera',
      seed: buildCameraGearSeed(exif.make, exif.model)
    }),
    resolveGalleryGear({
      database,
      actorId,
      kind: 'lens',
      seed: buildLensGearSeed(exif.lensModel)
    })
  ])

  return { cameraGearId: camera?.id ?? null, lensGearId: lens?.id ?? null }
}
