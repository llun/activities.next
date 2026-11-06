#!/usr/bin/env -S node scripts/run.cjs
// Regenerates the maskable PWA icons from `public/logo.png`.
//
// A maskable icon is cropped to whatever shape the launcher uses, so its
// artwork must sit inside the central 80% safe circle. The plain app icons fill
// the canvas, so this script draws the bird at 56% of the canvas (its corners
// stay inside the 40% radius) on the brand orange, and writes the two sizes the
// manifest names. The output is committed; run this only when the logo or the
// brand colour changes.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

// `--primary` in app/globals.css: hsl(24 95% 46%).
const BRAND_BACKGROUND = '#e55f06'
const ARTWORK_SCALE = 0.56
const SIZES = [192, 512]

const render = async (size: number) => {
  const artworkSize = Math.round(size * ARTWORK_SCALE)
  const artwork = await sharp(path.join('public', 'logo.png'))
    .resize(artworkSize, artworkSize, { fit: 'contain' })
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BRAND_BACKGROUND
    }
  })
    .composite([
      {
        input: artwork,
        left: Math.round((size - artworkSize) / 2),
        top: Math.round((size - artworkSize) / 2)
      }
    ])
    .png()
    .toBuffer()
}

const main = async () => {
  for (const size of SIZES) {
    const output = path.join('public', `icon-maskable-${size}.png`)
    await writeFile(output, await render(size))
    console.log(`wrote ${output}`)
  }
}

void main()
