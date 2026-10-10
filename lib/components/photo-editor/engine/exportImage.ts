import { getRecipeOutputSize } from '@/lib/services/medias/edit/geometry'
import type { Recipe } from '@/lib/services/medias/edit/recipe'

import { BLUR_MAX_EDGE } from './colour'
import { createCanvas, drawGeometry } from './geometryCanvas'
import { createRenderer } from './glRenderer'
import { fitLongEdge } from './previewSize'

export const EXPORT_QUALITY = 0.95

/**
 * Renders the recipe at its output size through the tiled path and returns a
 * JPEG blob (quality 0.95). Throws when WebGL 2 is unavailable or the context
 * is lost mid-render.
 */
export const exportRecipe = async (
  source: ImageBitmap,
  recipe: Recipe
): Promise<Blob> => {
  const output = getRecipeOutputSize(
    { width: source.width, height: source.height },
    recipe
  )
  const renderer = createRenderer(createCanvas(1, 1))
  if (!renderer) throw new Error('WebGL 2 is not available')

  try {
    const blurSize = fitLongEdge(output, BLUR_MAX_EDGE)
    const blur = drawGeometry(
      source,
      recipe.geometry,
      blurSize.width,
      blurSize.height
    )
    const wholeImage =
      output.width <= renderer.maxTextureSize &&
      output.height <= renderer.maxTextureSize
    const pixels = renderer.renderToPixels({
      output,
      blur,
      blurSize,
      adjustments: recipe.adjustments,
      wholeImage,
      getImage: (rect) =>
        drawGeometry(
          source,
          recipe.geometry,
          output.width,
          output.height,
          wholeImage ? undefined : rect
        )
    })
    if (renderer.isContextLost()) throw new Error('The render was interrupted')

    const canvas = createCanvas(pixels.width, pixels.height)
    const context = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!context) throw new Error('2D canvas is not available')
    context.putImageData(
      new ImageData(
        new Uint8ClampedArray(pixels.data),
        pixels.width,
        pixels.height
      ),
      0,
      0
    )
    if ('convertToBlob' in canvas) {
      return await canvas.convertToBlob({
        type: 'image/jpeg',
        quality: EXPORT_QUALITY
      })
    }
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Encoding failed'))),
        'image/jpeg',
        EXPORT_QUALITY
      )
    )
  } finally {
    renderer.dispose(true)
  }
}
