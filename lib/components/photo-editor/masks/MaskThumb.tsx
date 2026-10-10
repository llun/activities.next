'use client'

import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

import { resolveCssColour } from './cssColour'
import type { MaskRaster } from './maskRaster'
import { useThemeVersion } from './useThemeVersion'

const WIDTH = 34
const HEIGHT = 26

/** A 34 x 26 look at a mask: the inside in the info colour, nearest sampled. */
export const MaskThumb = ({
  raster,
  inverse = false,
  className
}: {
  /** Null draws an empty thumb (a background whose subject has no pixels). */
  raster: MaskRaster | null
  /** Draw 1 - mask, for a background. */
  inverse?: boolean
  className?: string
}) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const themeVersion = useThemeVersion()

  useEffect(() => {
    const element = canvas.current
    const context = element?.getContext('2d')
    if (!element || !context) return
    const [r, g, b] = resolveCssColour('var(--info)', [0.15, 0.39, 0.92])
    const image = context.createImageData(WIDTH, HEIGHT)
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        let value = 0
        if (raster) {
          const sx = Math.min(
            raster.width - 1,
            Math.floor(((x + 0.5) * raster.width) / WIDTH)
          )
          const sy = Math.min(
            raster.height - 1,
            Math.floor(((y + 0.5) * raster.height) / HEIGHT)
          )
          value = raster.data[sy * raster.width + sx]
          if (inverse) value = 255 - value
        }
        const at = (y * WIDTH + x) * 4
        image.data[at] = r * 255
        image.data[at + 1] = g * 255
        image.data[at + 2] = b * 255
        image.data[at + 3] = value
      }
    }
    context.putImageData(image, 0, 0)
  }, [raster, inverse, themeVersion])

  return (
    <canvas
      ref={canvas}
      width={WIDTH}
      height={HEIGHT}
      aria-hidden="true"
      className={cn('h-[26px] w-[34px] shrink-0 rounded bg-muted', className)}
    />
  )
}
