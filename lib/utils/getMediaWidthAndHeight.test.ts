/**
 * @vitest-environment jsdom
 */
import { getMediaWidthAndHeight } from './getMediaWidthAndHeight'

describe('getMediaWidthAndHeight', () => {
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:test-media')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
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

  it('resolves null when the browser cannot load the video', async () => {
    const file = new File(['broken'], 'clip.mp4', { type: 'video/mp4' })
    const video = stubElement('video')

    const pending = getMediaWidthAndHeight(file)
    video.dispatchEvent(new Event('error'))

    await expect(pending).resolves.toBeNull()
  })

  it('resolves null when the browser cannot load the image', async () => {
    const file = new File(['broken'], 'photo.png', { type: 'image/png' })
    const img = stubElement('img')

    const pending = getMediaWidthAndHeight(file)
    img.dispatchEvent(new Event('error'))

    await expect(pending).resolves.toBeNull()
  })

  it.each([
    ['video', 'clip.mp4', 'video/mp4', 'loadedmetadata'],
    ['img', 'photo.png', 'image/png', 'load']
  ] as const)(
    'releases the object URL once a %s has loaded',
    async (tagName, name, type, eventName) => {
      const file = new File(['bytes'], name, { type })
      const element = stubElement(tagName)

      const pending = getMediaWidthAndHeight(file)
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      element.dispatchEvent(new Event(eventName))
      await pending

      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-media')
    }
  )

  it.each([
    ['video', 'clip.mp4', 'video/mp4'],
    ['img', 'photo.png', 'image/png']
  ] as const)(
    'releases the object URL when a %s fails to load',
    async (tagName, name, type) => {
      const file = new File(['bytes'], name, { type })
      const element = stubElement(tagName)

      const pending = getMediaWidthAndHeight(file)
      expect(URL.revokeObjectURL).not.toHaveBeenCalled()
      element.dispatchEvent(new Event('error'))
      await pending

      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-media')
    }
  )

  it.each(['audio/mp4', 'application/pdf', 'text/plain', ''])(
    'returns null for %j without touching the object URL',
    async (type) => {
      const file = new File(['bytes'], 'file.bin', { type })

      await expect(getMediaWidthAndHeight(file)).resolves.toBeNull()
      expect(URL.createObjectURL).not.toHaveBeenCalled()
    }
  )
})
