import { NEUTRAL_RECIPE } from '@/lib/services/medias/edit/recipe'

import { exportRecipe } from './exportImage'
import { createRenderer } from './glRenderer'

vi.mock('./glRenderer', () => ({ createRenderer: vi.fn() }))
vi.mock('./geometryCanvas', () => ({
  createCanvas: vi.fn(() => makeCanvas()),
  drawGeometry: vi.fn(() => makeCanvas())
}))

interface FakeCanvas {
  width: number
  height: number
  getContext: () => unknown
  convertToBlob: () => Promise<Blob>
}
const canvases: FakeCanvas[] = []
const events: string[] = []
const makeCanvas = (): FakeCanvas => {
  const canvas: FakeCanvas = {
    width: 1,
    height: 1,
    getContext: () => ({
      putImageData: (image: { data: Uint8ClampedArray }) =>
        events.push(`put:${image.data === pixels.data}`)
    }),
    convertToBlob: async () => {
      events.push('encode')
      return new Blob([blobBytes])
    }
  }
  canvases.push(canvas)
  return canvas
}
let blobBytes = 'jpeg'
const pixels = { width: 2, height: 2, data: new Uint8ClampedArray(16) }

beforeEach(() => {
  events.length = 0
  canvases.length = 0
  blobBytes = 'jpeg'
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    }
  )
  vi.mocked(createRenderer).mockReturnValue({
    maxTextureSize: 4096,
    renderToPixels: () => pixels,
    isContextLost: () => false,
    dispose: () => events.push('dispose')
  } as never)
})

afterEach(() => vi.unstubAllGlobals())

const source = { width: 2, height: 2 } as ImageBitmap

describe('exportRecipe', () => {
  it('wraps the pixels without copying and frees the renderer before encoding', async () => {
    await exportRecipe(source, NEUTRAL_RECIPE)
    expect(events).toEqual(['dispose', 'put:true', 'encode'])
  })

  it('shrinks the export canvas when done', async () => {
    await exportRecipe(source, NEUTRAL_RECIPE)
    const exportCanvas = canvases[canvases.length - 1]
    expect([exportCanvas.width, exportCanvas.height]).toEqual([0, 0])
  })

  it('rejects an empty encoding', async () => {
    blobBytes = ''
    await expect(exportRecipe(source, NEUTRAL_RECIPE)).rejects.toThrow(
      'Encoding failed'
    )
  })
})
