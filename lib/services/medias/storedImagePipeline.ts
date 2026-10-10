import sharp from 'sharp'

import { MASK_LONG_EDGE } from '@/lib/services/medias/edit/recipe'

import { MAX_HEIGHT, MAX_WIDTH } from './constants'

// `withoutEnlargement` is load-bearing: sharp's `fit: 'inside'` ENLARGES by
// default, so without it the MAX_WIDTH/MAX_HEIGHT box stops being a cap and
// becomes an upscale — every image below 4000x4000 was blown up to fill it. An
// 800x600 route map (39 KB PNG) was stored as a 4000x3000 WebP of 271 KB, a
// size no surface ever displays. Matches `lib/utils/resizeImage.ts`, which the
// browser upload path already applies as a downscale-only cap.
const STORED_IMAGE_RESIZE_OPTIONS = {
  fit: 'inside',
  withoutEnlargement: true
} as const

// The input half of every stored-image encode: apply the image's EXIF
// orientation and fit the result inside the MAX_WIDTH/MAX_HEIGHT box. Both
// storage drivers encode through it, and `readValidThumbnail` decodes through
// it, so validating a thumbnail rejects exactly what the encode would — and the
// two cannot drift, because there is one chain.
//
// Server-only: it imports sharp, so it stays out of `constants.ts`, which
// client components import.
export const createStoredImagePipeline = (input: Buffer) =>
  sharp(input)
    .resize(MAX_WIDTH, MAX_HEIGHT, STORED_IMAGE_RESIZE_OPTIONS)
    .rotate()

// A photo edit mask is stored at most `MASK_LONG_EDGE` long on its long edge,
// in the source photo's shape (spec §6.1); the client renders it at exactly
// that size.
export const STORED_MASK_MAX_LONG_EDGE = MASK_LONG_EDGE

// The input half of a stored mask's encode: the first channel of the decoded
// image (a mask is one 8-bit alpha, 0 outside, 255 inside), fitted inside the
// mask box without enlarging. No `.rotate()`: the client's mask PNG carries no
// orientation tag, and it is already in the editor's source space (the
// oriented image the editor decoded), so there is nothing to turn.
export const createStoredMaskPipeline = (input: Buffer) =>
  sharp(input)
    .extractChannel(0)
    .resize(
      STORED_MASK_MAX_LONG_EDGE,
      STORED_MASK_MAX_LONG_EDGE,
      STORED_IMAGE_RESIZE_OPTIONS
    )
