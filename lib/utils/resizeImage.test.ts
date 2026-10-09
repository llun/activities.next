/**
 * @vitest-environment jsdom
 */
import { resizeImage } from './resizeImage'

type FakeContext = { drawImage: ReturnType<typeof vi.fn> }

describe('resizeImage', () => {
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const originalImage = globalThis.Image

  // What the decoded image reports. jsdom cannot decode bytes, so the stub
  // Image reports these once its src is set; `decodeFails` fires onerror.
  let decoded = { width: 0, height: 0 }
  let decodeFails = false
  let canvases: { canvas: HTMLCanvasElement; context: FakeContext }[] = []
  let toBlobResult: Blob | null = null
  let toBlobArgs: { type?: string; quality?: number } = {}

  beforeEach(() => {
    decoded = { width: 0, height: 0 }
    decodeFails = false
    canvases = []
    toBlobResult = new Blob(['resized-bytes'], { type: 'image/jpeg' })
    toBlobArgs = {}

    URL.createObjectURL = vi.fn().mockReturnValue('blob:source-image')
    URL.revokeObjectURL = vi.fn()

    class StubImage {
      onload: (() => void) | null = null
      onerror: ((error: unknown) => void) | null = null
      width = 0
      height = 0
      private source = ''
      get src() {
        return this.source
      }
      set src(value: string) {
        this.source = value
        queueMicrotask(() => {
          if (decodeFails) {
            this.onerror?.(new Event('error'))
            return
          }
          this.width = decoded.width
          this.height = decoded.height
          this.onload?.()
        })
      }
    }
    vi.stubGlobal('Image', StubImage)

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function (this: HTMLCanvasElement) {
        const context: FakeContext = { drawImage: vi.fn() }
        canvases.push({ canvas: this, context })
        return context as unknown as CanvasRenderingContext2D
      } as unknown as HTMLCanvasElement['getContext']
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback: BlobCallback, type?: string, quality?: unknown) => {
        toBlobArgs = { type, quality: quality as number }
        callback(toBlobResult)
      }
    )
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.stubGlobal('Image', originalImage)
    vi.restoreAllMocks()
  })

  const jpeg = (name = 'photo.jpg') =>
    new File(['original-bytes'], name, { type: 'image/jpeg' })

  it.each(['image/gif', 'image/webp', 'video/mp4', 'text/plain'])(
    'returns a %s file untouched without decoding it',
    async (type) => {
      const file = new File(['bytes'], 'file', { type })
      const readSpy = vi.spyOn(FileReader.prototype, 'readAsArrayBuffer')

      await expect(resizeImage(file, 100, 100)).resolves.toBe(file)
      expect(readSpy).not.toHaveBeenCalled()
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['exactly at both limits', { width: 4000, height: 4000 }],
    ['smaller than both limits', { width: 800, height: 600 }]
  ])('returns the original file when the image is %s', async (_, size) => {
    decoded = size
    const file = jpeg()

    await expect(resizeImage(file, 4000, 4000)).resolves.toBe(file)
    expect(canvases).toHaveLength(0)
  })

  it('releases the temporary object URL once the image has decoded', async () => {
    decoded = { width: 10, height: 10 }

    await resizeImage(jpeg(), 100, 100)

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:source-image')
  })

  it.each([
    {
      description: 'a landscape image is scaled down to the width limit',
      source: { width: 8000, height: 6000 },
      limits: [4000, 4000],
      expected: { width: 4000, height: 3000 }
    },
    {
      description: 'a portrait image is scaled down to the height limit',
      source: { width: 3000, height: 6000 },
      limits: [4000, 4000],
      expected: { width: 2000, height: 4000 }
    },
    {
      description: 'a square image is scaled down to the height limit',
      source: { width: 5000, height: 5000 },
      limits: [4000, 4000],
      expected: { width: 4000, height: 4000 }
    },
    {
      description:
        'a landscape image is scaled by the height limit when width-scaling would still exceed it',
      source: { width: 1000, height: 900 },
      limits: [800, 600],
      expected: { width: 667, height: 600 }
    },
    {
      description:
        'a portrait image is scaled by the width limit when height-scaling would still exceed it',
      source: { width: 900, height: 1000 },
      limits: [600, 800],
      expected: { width: 600, height: 667 }
    },
    {
      description: 'the scaled edge is rounded to a whole pixel',
      source: { width: 4001, height: 3002 },
      limits: [4000, 4000],
      expected: { width: 4000, height: 3001 }
    },
    {
      description:
        'a very thin image keeps at least one pixel on its short edge',
      source: { width: 100000, height: 1 },
      limits: [4000, 4000],
      expected: { width: 4000, height: 1 }
    }
  ])('$description', async ({ source, limits, expected }) => {
    decoded = source

    await resizeImage(jpeg(), limits[0], limits[1])

    const [original, destination] = canvases
    expect(original.canvas).toMatchObject(source)
    expect(destination.canvas).toMatchObject(expected)
    expect(destination.context.drawImage).toHaveBeenCalledWith(
      original.canvas,
      0,
      0,
      source.width,
      source.height,
      0,
      0,
      expected.width,
      expected.height
    )
  })

  it('returns a new file with the same name and type, encoded at quality 0.8', async () => {
    decoded = { width: 8000, height: 6000 }
    const file = jpeg('holiday.jpg')

    const resized = await resizeImage(file, 4000, 4000)

    expect(resized).not.toBe(file)
    expect(resized).toBeInstanceOf(File)
    expect(resized.name).toBe('holiday.jpg')
    expect(resized.type).toBe('image/jpeg')
    expect(await resized.text()).toBe('resized-bytes')
    expect(toBlobArgs).toEqual({ type: 'image/jpeg', quality: 0.8 })
  })

  it('keeps the PNG type when re-encoding a png', async () => {
    decoded = { width: 8000, height: 6000 }
    const file = new File(['png-bytes'], 'shot.png', { type: 'image/png' })

    const resized = await resizeImage(file, 4000, 4000)

    expect(resized.type).toBe('image/png')
    expect(toBlobArgs.type).toBe('image/png')
  })

  it('falls back to the original file when the canvas cannot encode the image', async () => {
    decoded = { width: 8000, height: 6000 }
    toBlobResult = null
    const file = jpeg()

    await expect(resizeImage(file, 4000, 4000)).resolves.toBe(file)
  })

  it('rejects when the browser cannot decode the image', async () => {
    decodeFails = true

    await expect(resizeImage(jpeg(), 4000, 4000)).rejects.toBeInstanceOf(Event)
    expect(canvases).toHaveLength(0)
  })

  it('rejects when the file cannot be read', async () => {
    const failure = new Error('read failed')
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(
      function (this: FileReader) {
        queueMicrotask(() =>
          this.onerror?.(failure as unknown as ProgressEvent<FileReader>)
        )
      }
    )

    await expect(resizeImage(jpeg(), 4000, 4000)).rejects.toBe(failure)
  })
})
