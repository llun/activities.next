/**
 * @vitest-environment jsdom
 */
import { extractVideoPoster } from './extractVideoPoster'

describe('extractVideoPoster', () => {
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    URL.createObjectURL = vi.fn().mockReturnValue('blob:test-video')
    URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.restoreAllMocks()
  })

  it('returns null for non-video files', async () => {
    const file = new File(['image'], 'image.png', { type: 'image/png' })
    const result = await extractVideoPoster(file)
    expect(result).toBeNull()
  })

  it('extracts a poster frame from a video file', async () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })

    const mockDrawImage = vi.fn()
    const mockToBlob = vi.fn((callback: (blob: Blob | null) => void) => {
      callback(new Blob(['fake-image-bytes'], { type: 'image/jpeg' }))
    })

    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(
      (tagName: string) => {
        if (tagName === 'video') {
          const video = createElement('video') as HTMLVideoElement
          Object.defineProperty(video, 'videoWidth', { value: 1280 })
          Object.defineProperty(video, 'videoHeight', { value: 720 })
          Object.defineProperty(video, 'duration', { value: 10 })

          // Simulate browser seeking
          let currentTimeVal = 0
          Object.defineProperty(video, 'currentTime', {
            get: () => currentTimeVal,
            set: (val: number) => {
              currentTimeVal = val
              setTimeout(() => {
                video.onseeked?.(new Event('seeked'))
              }, 0)
            }
          })

          // Trigger loadedmetadata after src is set
          setTimeout(() => {
            video.onloadedmetadata?.(new Event('loadedmetadata'))
          }, 0)

          return video
        }
        if (tagName === 'canvas') {
          const canvas = createElement('canvas') as HTMLCanvasElement
          vi.spyOn(canvas, 'getContext').mockReturnValue({
            drawImage: mockDrawImage
          } as unknown as CanvasRenderingContext2D)
          canvas.toBlob = mockToBlob
          return canvas
        }
        return createElement(tagName)
      }
    )

    const result = await extractVideoPoster(file)

    expect(result).toBeInstanceOf(File)
    expect(result?.name).toBe('poster.jpg')
    expect(result?.type).toBe('image/jpeg')
    expect(mockDrawImage).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-video')
  })

  it('returns null when video encounters an error', async () => {
    const file = new File(['corrupt-video'], 'corrupt.mp4', {
      type: 'video/mp4'
    })

    const createElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation(
      (tagName: string) => {
        if (tagName === 'video') {
          const video = createElement('video') as HTMLVideoElement
          setTimeout(() => {
            video.onerror?.(new Event('error'))
          }, 0)
          return video
        }
        return createElement(tagName)
      }
    )

    const result = await extractVideoPoster(file)
    expect(result).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-video')
  })
})
