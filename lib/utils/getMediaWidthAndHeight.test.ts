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

  // Hands the function a real element of the requested kind. jsdom cannot
  // decode a size from bytes, so tests set it with setSize at the moment the
  // browser would, which keeps an implementation that reads the size before
  // the load event from passing.
  const stubElement = (tagName: 'video' | 'img') => {
    const createElement = document.createElement.bind(document)
    const element = createElement(tagName)
    vi.spyOn(document, 'createElement').mockImplementation((name: string) =>
      name === tagName ? element : createElement(name)
    )
    return element
  }

  const setSize = (element: Element, size: Record<string, number>) => {
    for (const [key, value] of Object.entries(size)) {
      Object.defineProperty(element, key, { value })
    }
  }

  it('reads the intrinsic size of a video once its metadata has loaded', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })
    const video = stubElement('video')

    const pending = getMediaWidthAndHeight(file)
    expect(video.getAttribute('src')).toBe('blob:test-media')
    expect(URL.createObjectURL).toHaveBeenCalledWith(file)
    setSize(video, { videoWidth: 1920, videoHeight: 1080 })
    ;(video as HTMLVideoElement).onloadedmetadata?.(new Event('loadedmetadata'))

    await expect(pending).resolves.toEqual({ width: 1920, height: 1080 })
  })

  it('reads the size of an image once it has loaded', async () => {
    const file = new File(['image'], 'photo.png', { type: 'image/png' })
    const img = stubElement('img')

    const pending = getMediaWidthAndHeight(file)
    expect(img.getAttribute('src')).toBe('blob:test-media')
    setSize(img, { width: 640, height: 480 })
    ;(img as HTMLImageElement).onload?.(new Event('load'))

    await expect(pending).resolves.toEqual({ width: 640, height: 480 })
  })

  it.each(['audio/mp4', 'application/pdf', 'text/plain', ''])(
    'returns null for %j without touching the object URL',
    async (type) => {
      const file = new File(['bytes'], 'file.bin', { type })

      await expect(getMediaWidthAndHeight(file)).resolves.toBeNull()
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    }
  )
})
