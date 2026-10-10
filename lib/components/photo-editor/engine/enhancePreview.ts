import { getRecipeOutputSize } from '@/lib/services/medias/edit/geometry'
import type { Geometry } from '@/lib/services/medias/edit/recipe'

import { drawGeometry } from './geometryCanvas'
import { fitLongEdge } from './previewSize'

/** The most the server accepts on the long edge of an enhance preview. */
export const ENHANCE_PREVIEW_EDGE = 1536
export const ENHANCE_PREVIEW_QUALITY = 0.85

/** The preview's pixel size: the geometry's output, at most 1536 px long. */
export const getEnhancePreviewSize = (
  source: { width: number; height: number },
  geometry: Geometry
) =>
  fitLongEdge(getRecipeOutputSize(source, { geometry }), ENHANCE_PREVIEW_EDGE)

/**
 * The photo through the current rotate, flip, straighten and crop with every
 * adjustment neutral, as a JPEG of at most 1536 px on the long edge. It is
 * drawn with Canvas2D alone, so it needs no WebGL.
 */
export const renderEnhancePreview = async (
  source: ImageBitmap,
  geometry: Geometry
): Promise<Blob> => {
  const { width, height } = getEnhancePreviewSize(source, geometry)
  const canvas = drawGeometry(source, geometry, width, height)
  try {
    const blob =
      'convertToBlob' in canvas
        ? await canvas.convertToBlob({
            type: 'image/jpeg',
            quality: ENHANCE_PREVIEW_QUALITY
          })
        : await new Promise<Blob>((resolve, reject) =>
            (canvas as HTMLCanvasElement).toBlob(
              (encoded) =>
                encoded
                  ? resolve(encoded)
                  : reject(new Error('Encoding failed')),
              'image/jpeg',
              ENHANCE_PREVIEW_QUALITY
            )
          )
    if (blob.size === 0) throw new Error('Encoding failed')
    return blob
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
