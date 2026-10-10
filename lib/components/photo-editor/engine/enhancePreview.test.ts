import { describe, expect, it, vi } from 'vitest'

import { NEUTRAL_RECIPE } from '@/lib/services/medias/edit/recipe'

import {
  ENHANCE_PREVIEW_EDGE,
  getEnhancePreviewSize,
  renderEnhancePreview
} from './enhancePreview'
import { drawGeometry } from './geometryCanvas'

vi.mock('./geometryCanvas', () => ({ drawGeometry: vi.fn() }))

const { geometry } = NEUTRAL_RECIPE

describe('getEnhancePreviewSize', () => {
  it.each([
    ['a large landscape', { width: 6000, height: 4000 }, 1536, 1024],
    ['a large portrait', { width: 3000, height: 4000 }, 1152, 1536],
    ['a small photo is not enlarged', { width: 800, height: 600 }, 800, 600],
    ['exactly 1536', { width: 1536, height: 1000 }, 1536, 1000]
  ])('%s', (_, source, width, height) => {
    expect(getEnhancePreviewSize(source, geometry)).toEqual({ width, height })
  })

  it('follows the crop', () => {
    const cropped = {
      ...geometry,
      crop: { x: 0, y: 0, width: 0.5, height: 1 }
    }
    expect(
      getEnhancePreviewSize({ width: 4000, height: 3000 }, cropped)
    ).toEqual({ width: 1024, height: 1536 })
  })

  it('follows a quarter turn', () => {
    expect(
      getEnhancePreviewSize(
        { width: 4000, height: 2000 },
        { ...geometry, rotate90: 1 }
      )
    ).toEqual({ width: 768, height: 1536 })
  })

  it('never exceeds the server cap', () => {
    const { width, height } = getEnhancePreviewSize(
      { width: 20000, height: 20000 },
      geometry
    )
    expect(Math.max(width, height)).toBeLessThanOrEqual(ENHANCE_PREVIEW_EDGE)
  })
})

describe('renderEnhancePreview', () => {
  const source = { width: 4000, height: 3000 } as ImageBitmap

  const canvasWith = (blob: Blob) => ({
    width: 1,
    height: 1,
    convertToBlob: vi.fn(async () => blob)
  })

  it('draws the geometry at the preview size and encodes a JPEG', async () => {
    const canvas = canvasWith(new Blob(['jpeg'], { type: 'image/jpeg' }))
    vi.mocked(drawGeometry).mockReturnValue(
      canvas as unknown as ReturnType<typeof drawGeometry>
    )

    const blob = await renderEnhancePreview(source, geometry)

    expect(drawGeometry).toHaveBeenCalledWith(source, geometry, 1536, 1152)
    expect(canvas.convertToBlob).toHaveBeenCalledWith({
      type: 'image/jpeg',
      quality: 0.85
    })
    expect(blob.size).toBe(4)
  })

  it('frees the canvas when done', async () => {
    const canvas = canvasWith(new Blob(['jpeg']))
    vi.mocked(drawGeometry).mockReturnValue(
      canvas as unknown as ReturnType<typeof drawGeometry>
    )
    await renderEnhancePreview(source, geometry)
    expect([canvas.width, canvas.height]).toEqual([0, 0])
  })

  it('rejects an empty encoding', async () => {
    vi.mocked(drawGeometry).mockReturnValue(
      canvasWith(new Blob([])) as unknown as ReturnType<typeof drawGeometry>
    )
    await expect(renderEnhancePreview(source, geometry)).rejects.toThrow(
      'Encoding failed'
    )
  })
})
