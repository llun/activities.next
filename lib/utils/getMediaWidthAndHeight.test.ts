/**
 * @vitest-environment jsdom
 */
import { getMediaWidthAndHeight } from './getMediaWidthAndHeight'

describe('getMediaWidthAndHeight', () => {
  const originalCreateObjectURL = URL.createObjectURL

  beforeEach(() => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:test-media')
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    vi.restoreAllMocks()
  })

  // Hands the function a real element of the requested kind, with the
  // intrinsic size jsdom cannot decode from bytes.
  const stubElement = (
    tagName: 'video' | 'img',
    size: Record<string, number>
  ) => {
    const createElement = document.createElement.bind(document)
    const element = createElement(tagName)
    for (const [key, value] of Object.entries(size)) {
      Object.defineProperty(element, key, { value })
    }
    vi.spyOn(document, 'createElement').mockImplementation((name: string) =>
      name === tagName ? element : createElement(name)
    )
    return element
  }

  it('reads the intrinsic size of a video once its metadata has loaded', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const video = stubElement('video', { videoWidth: 1920, videoHeight: 1080 })

    const pending = getMediaWidthAndHeight(file)
    expect(video.getAttribute('src')).toBe('blob:test-media')
    expect(URL.createObjectURL).toHaveBeenCalledWith(file)
    ;(video as HTMLVideoElement).onloadedmetadata?.(new Event('loadedmetadata'))

    await expect(pending).resolves.toEqual({ width: 1920, height: 1080 })
  })

  it('reads the size of an image once it has loaded', async () => {
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    const img = stubElement('img', { width: 640, height: 480 })

    const pending = getMediaWidthAndHeight(file)
    expect(img.getAttribute('src')).toBe('blob:test-media')
    ;(img as HTMLImageElement).onload?.(new Event('load'))

    await expect(pending).resolves.toEqual({ width: 640, height: 480 })
  })

  it('does not report a size before the media has loaded', async () => {
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    stubElement('img', { width: 640, height: 480 })

    const settled = vi.fn()
    void getMediaWidthAndHeight(file).then(settled)
    await Promise.resolve()

    expect(settled).not.toHaveBeenCalled()
  })

  it.each(['audio/mp4', 'application/pdf', 'text/plain', ''])(
    'returns null for %j without touching the object URL',
    async (type) => {
      const file = new File(['bytes'], 'file.bin', { type })

      await expect(getMediaWidthAndHeight(file)).resolves.toBeNull()
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    }
  )

  // The promise only resolves from onloadedmetadata / onload and nothing
  // handles onerror, so a corrupt file hangs the caller (lib/client/media.ts)
  // forever instead of failing the upload.
  it.todo(
    'settles instead of hanging when a video or image fails to decode (lib/utils/getMediaWidthAndHeight.ts:5-18)'
  )
})
