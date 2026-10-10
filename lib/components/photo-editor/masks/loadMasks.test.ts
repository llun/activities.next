import { NEUTRAL_RECIPE, type Recipe } from '@/lib/services/medias/edit/recipe'

import { loadMaskRasters } from './loadMasks'
import { createRaster } from './maskRaster'
import { addBackgroundMask, addBrushMask, addSubjectMask } from './maskRecipe'
import { decodeMaskPng } from './pngCodec'

vi.mock('./pngCodec', () => ({ decodeMaskPng: vi.fn() }))

const mockBlob = vi.fn()
vi.mock('@/lib/client', () => ({
  getMediaEditMaskBlob: (...args: unknown[]) => mockBlob(...args)
}))

const recipe = (): Recipe => {
  let next = addSubjectMask(NEUTRAL_RECIPE, 'aaaaaaaa', {
    x: 0.5,
    y: 0.5,
    label: 1
  })
  next = addBackgroundMask(next, 'bbbbbbbb', 'aaaaaaaa')
  return addBrushMask(next, 'cccccccc')
}

const FILES = [
  { id: 'aaaaaaaa', url: '/a' },
  { id: 'cccccccc', url: '/c' }
]

describe('loadMaskRasters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBlob.mockImplementation(async (url: string) => new Blob([url]))
    vi.mocked(decodeMaskPng).mockImplementation(async () =>
      createRaster({ width: 2, height: 2 }, 255)
    )
  })

  it('reads the mask of every subject and brush, and not the background', async () => {
    const { rasters, failed } = await loadMaskRasters(recipe(), FILES)
    expect(Object.keys(rasters).sort()).toEqual(['aaaaaaaa', 'cccccccc'])
    expect(failed).toEqual([])
    expect(mockBlob).toHaveBeenCalledTimes(2)
  })

  it('reports a mask whose file is gone and still loads the others', async () => {
    mockBlob.mockImplementation(async (url: string) => {
      if (url === '/a') throw new Error('Record not found')
      return new Blob([url])
    })
    const { rasters, failed } = await loadMaskRasters(recipe(), FILES)
    expect(failed).toEqual(['aaaaaaaa'])
    expect(Object.keys(rasters)).toEqual(['cccccccc'])
  })

  it('reports a mask the server does not list, and one that does not decode', async () => {
    vi.mocked(decodeMaskPng).mockRejectedValueOnce(new Error('bad png'))
    const { rasters, failed } = await loadMaskRasters(recipe(), [FILES[0]])
    expect(failed.sort()).toEqual(['aaaaaaaa', 'cccccccc'])
    expect(rasters).toEqual({})
  })

  it('rejects when the load was aborted', async () => {
    const controller = new AbortController()
    mockBlob.mockImplementation(async () => {
      controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    })
    await expect(
      loadMaskRasters(recipe(), FILES, controller.signal)
    ).rejects.toThrow()
  })

  it('has nothing to load without a stored recipe', async () => {
    expect(await loadMaskRasters(null, [])).toEqual({ rasters: {}, failed: [] })
  })
})
