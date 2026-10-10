import type { Size } from '@/lib/services/medias/edit/geometry'

/** Largest long edge of the preview canvas, in device pixels (§2.5). */
export const MAX_PREVIEW_EDGE = 2048

/** Scales `size` down so its long edge is at most `maxEdge` (never up). */
export const fitLongEdge = (size: Size, maxEdge: number): Size => {
  const longEdge = Math.max(size.width, size.height)
  if (longEdge <= maxEdge) return { ...size }
  const scale = maxEdge / longEdge
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  }
}

/** The largest size of `aspect` (w:h) that fits inside `box`. */
export const containSize = (aspect: number, box: Size): Size => {
  if (box.width <= 0 || box.height <= 0 || !(aspect > 0)) {
    return { width: 0, height: 0 }
  }
  const width = Math.min(box.width, box.height * aspect)
  return { width, height: width / aspect }
}

export interface PreviewSizes {
  /** The canvas's CSS size. */
  css: Size
  /** The canvas's pixel size. */
  pixels: Size
}

/**
 * Preview size: the output fitted into the stage box, times the device pixel
 * ratio, capped at 2048 on the long edge and never above the output itself.
 */
export const getPreviewSizes = (
  output: Size,
  box: Size,
  devicePixelRatio: number
): PreviewSizes => {
  const css = containSize(output.width / output.height, box)
  const wanted = {
    width: Math.max(1, Math.round(css.width * devicePixelRatio)),
    height: Math.max(1, Math.round(css.height * devicePixelRatio))
  }
  const capped = fitLongEdge(wanted, MAX_PREVIEW_EDGE)
  return {
    css,
    pixels: {
      width: Math.min(capped.width, Math.max(1, output.width)),
      height: Math.min(capped.height, Math.max(1, output.height))
    }
  }
}
