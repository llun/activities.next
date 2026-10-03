import sharp from 'sharp'

import { MAX_HEIGHT, MAX_WIDTH, STORED_IMAGE_RESIZE_OPTIONS } from './constants'

// The input half of every stored-image encode: fit the image inside the
// MAX_WIDTH/MAX_HEIGHT box, then apply its EXIF orientation. Both storage
// drivers encode through it, and `readValidThumbnail` decodes through it, so
// validating a thumbnail rejects exactly what the encode would — and the two
// cannot drift, because there is one chain.
//
// Server-only: `constants.ts` is imported by client components, so this lives
// beside sharp rather than there.
export const createStoredImagePipeline = (input: Buffer) =>
  sharp(input)
    .resize(MAX_WIDTH, MAX_HEIGHT, STORED_IMAGE_RESIZE_OPTIONS)
    .rotate()
