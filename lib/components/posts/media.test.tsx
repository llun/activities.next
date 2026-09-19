/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PlaybackPreferencesProvider } from '@/lib/components/preferences/PlaybackPreferencesContext'
import { Attachment } from '@/lib/types/domain/attachment'

import { Media } from './media'

// Mock BlurhashCanvas to easily assert its rendering
vi.mock('./BlurhashCanvas', () => ({
  BlurhashCanvas: ({
    blurhash,
    className,
    style
  }: {
    blurhash: string
    className?: string
    style?: React.CSSProperties
  }) => (
    <div
      data-testid="blurhash-canvas"
      data-blurhash={blurhash}
      className={className}
      style={style}
    />
  )
}))

describe('Media', () => {
  // Restoration has to happen here rather than at the end of the test that
  // installs the spies: a failing assertion would skip it, leaving
  // `HTMLImageElement.prototype.complete` mocked true for every later test
  // and turning one failure into a cascade that masks it.
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const baseAttachment: Attachment = {
    id: 'att-1',
    actorId: 'actor-1',
    statusId: 'status-1',
    type: 'Document',
    mediaType: 'image/jpeg',
    url: 'https://example.com/image.jpg',
    width: 800,
    height: 600,
    name: 'An image',
    createdAt: 1000,
    updatedAt: 1000
  }

  it('renders standard image with default center object position', () => {
    render(<Media attachment={baseAttachment} />)

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://example.com/image.jpg')
    expect(img).toHaveStyle({ objectPosition: '50% 50%' })
    expect(screen.queryByTestId('blurhash-canvas')).not.toBeInTheDocument()
  })

  it('renders image with focal point object position', () => {
    const attachmentWithFocus: Attachment = {
      ...baseAttachment,
      focus: { x: -1, y: 1 } // Top-left -> 0% 0%
    }

    render(<Media attachment={attachmentWithFocus} />)

    const img = screen.getByRole('img')
    expect(img).toHaveStyle({ objectPosition: '0% 0%' })
  })

  it('renders BlurhashCanvas and transitions opacity when image loads', () => {
    const attachmentWithBlurhash: Attachment = {
      ...baseAttachment,
      blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      focus: { x: -1, y: 1 }
    }

    const { container } = render(<Media attachment={attachmentWithBlurhash} />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveStyle({ aspectRatio: '800 / 600' })

    const canvas = screen.getByTestId('blurhash-canvas')
    expect(canvas).toBeInTheDocument()
    expect(canvas).toHaveAttribute(
      'data-blurhash',
      'LEHV6nWB2yk8pyo0adR*.7kCMdnj'
    )
    expect(canvas).toHaveStyle({ objectPosition: '0% 0%' })
    expect(canvas.className).toContain('opacity-100')

    const img = screen.getByRole('img')
    expect(img).toBeInTheDocument()
    expect(img).toHaveStyle({ objectPosition: '0% 0%' })
    expect(img.className).toContain('opacity-0')

    // Simulate image load event
    fireEvent.load(img)

    expect(img.className).toContain('opacity-100')
    expect(canvas.className).toContain('opacity-0')
  })

  // A cached image is already complete before React attaches `onLoad`, so
  // without a complete/naturalWidth check the placeholder would sit at full
  // opacity over a picture that is already painted.
  //
  // On mount BOTH guards reach that result, so this test pins neither on its
  // own — deleting either one alone leaves it green. The inline `ref` arrow is
  // a new function every render, so React reattaches it constantly and it can
  // only ever set `isLoaded` true; the effect reads the same two getters
  // through `imgRef.current` but re-runs only when the url changes, and is the
  // only one that can set it back to false. The two tests below isolate them:
  // one holds the url steady, the other changes it.
  it('reveals a cached image that was already complete on mount', () => {
    const attachmentWithBlurhash: Attachment = {
      ...baseAttachment,
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
    }

    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(
      true
    )
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(
      800
    )

    render(<Media attachment={attachmentWithBlurhash} />)

    expect(screen.getByRole('img')).toHaveClass('opacity-100')
    expect(screen.getByTestId('blurhash-canvas')).toHaveClass('opacity-0')
  })

  // The `ref` callback's own `node.complete && node.naturalWidth > 0` check.
  // The mount effect covers the same ground, but its dependency array is
  // `[attachment?.url]`, so it does not re-run when the `<img>` remounts on a
  // changed `key={id}` with the url unchanged. In that case the callback is
  // the only thing that reveals an already-painted picture.
  it('reveals a cached image when the img remounts without the url changing', () => {
    let complete = false
    let naturalWidth = 0
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(
      () => complete
    )
    vi.spyOn(
      HTMLImageElement.prototype,
      'naturalWidth',
      'get'
    ).mockImplementation(() => naturalWidth)

    const attachment: Attachment = {
      ...baseAttachment,
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
    }

    const { rerender } = render(<Media attachment={attachment} />)
    expect(screen.getByRole('img')).toHaveClass('opacity-0')

    // Same url, new id: the effect does not re-run, but `key={id}` remounts
    // the element, so the replacement node arrives already complete.
    complete = true
    naturalWidth = 800
    rerender(<Media attachment={{ ...attachment, id: 'att-2' }} />)

    expect(screen.getByRole('img')).toHaveClass('opacity-100')
    expect(screen.getByTestId('blurhash-canvas')).toHaveClass('opacity-0')
  })

  // The effect's `else` branch, which nothing else can reach: the ref callback
  // only ever sets `isLoaded` true. Without the reset, swapping in a new url
  // would show the incoming picture at full opacity before it had loaded,
  // wearing the previous image's "loaded" state.
  it('repaints the placeholder when the attachment url changes', () => {
    let complete = true
    let naturalWidth = 800
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(
      () => complete
    )
    vi.spyOn(
      HTMLImageElement.prototype,
      'naturalWidth',
      'get'
    ).mockImplementation(() => naturalWidth)

    const attachment: Attachment = {
      ...baseAttachment,
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
    }

    const { rerender } = render(<Media attachment={attachment} />)
    expect(screen.getByRole('img')).toHaveClass('opacity-100')

    complete = false
    naturalWidth = 0
    rerender(
      <Media
        attachment={{ ...attachment, url: 'https://example.com/other.jpg' }}
      />
    )

    expect(screen.getByRole('img')).toHaveClass('opacity-0')
    expect(screen.getByTestId('blurhash-canvas')).toHaveClass('opacity-100')
  })

  // There is no `onError`, so a picture that never loads leaves `isLoaded`
  // false: the `<img>` stays transparent and the blurhash stays painted. That
  // is a reasonable end state — a blur beats a broken-image icon — but it is
  // the fall-through rather than a decision, and it is worth pinning either
  // way so a future `onError` is a deliberate change.
  it('leaves the placeholder painted when the image fails to load', () => {
    const attachmentWithBlurhash: Attachment = {
      ...baseAttachment,
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
    }

    render(<Media attachment={attachmentWithBlurhash} />)
    fireEvent.error(screen.getByRole('img'))

    expect(screen.getByTestId('blurhash-canvas')).toHaveClass('opacity-100')
    expect(screen.getByRole('img')).toHaveClass('opacity-0')
  })

  // Federation does not have to send dimensions. Without them there is no
  // `aspect-ratio` on the wrapper, so the absolutely-positioned canvas has no
  // height to fill and the placeholder collapses.
  it('renders a blurhash attachment that carries no dimensions', () => {
    const attachmentWithoutSize: Attachment = {
      ...baseAttachment,
      width: undefined,
      height: undefined,
      blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4'
    }

    const { container } = render(<Media attachment={attachmentWithoutSize} />)

    expect(screen.getByTestId('blurhash-canvas')).toBeInTheDocument()
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.style.aspectRatio).toBe('')
  })

  it('renders video with poster and focal point object position', () => {
    const videoAttachment: Attachment = {
      ...baseAttachment,
      mediaType: 'video/mp4',
      url: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      focus: { x: 0.5, y: -0.5 }
    }

    const { container } = render(<Media attachment={videoAttachment} />)

    const video = container.querySelector('video')
    expect(video).toBeInTheDocument()
    expect(video).toHaveAttribute('poster', 'https://example.com/thumb.jpg')
    expect(video).toHaveAttribute('aria-label', 'An image')
    expect(video).toHaveStyle({ objectPosition: '75% 75%' })
    // A poster alone must not defer the fetch. Only a strip item asks for that,
    // by passing `loading="lazy"`; every other caller — the lightbox, which
    // shows controls, and the lone-video branch — omits it and keeps the
    // element's own `metadata` default.
    expect(video).not.toHaveAttribute('preload')
  })

  it('labels a video with the caption first, then the attachment name', () => {
    const videoAttachment: Attachment = {
      ...baseAttachment,
      mediaType: 'video/mp4',
      url: 'https://example.com/video.mp4'
    }

    const { container, rerender } = render(
      <Media attachment={videoAttachment} caption="A cat playing piano" />
    )
    expect(container.querySelector('video')).toHaveAttribute(
      'aria-label',
      'A cat playing piano'
    )

    // No caption: the attachment's own name is the alt text.
    rerender(<Media attachment={videoAttachment} />)
    expect(container.querySelector('video')).toHaveAttribute(
      'aria-label',
      'An image'
    )
  })

  describe('animation playback (GIFV and GIF)', () => {
    beforeEach(() => {
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    })

    const gifvAttachment: Attachment = {
      ...baseAttachment,
      mediaType: 'video/mp4',
      playbackType: 'gifv',
      url: 'https://example.com/animation.mp4',
      thumbnailUrl: 'https://example.com/animation-poster.jpg'
    }

    const gifAttachment: Attachment = {
      ...baseAttachment,
      mediaType: 'image/gif',
      url: 'https://example.com/animated.gif',
      thumbnailUrl: 'https://example.com/static-thumb.png'
    }

    it('renders GIFV with loop, muted, playsInline, poster and no controls in timeline', () => {
      const { container } = render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <Media attachment={gifvAttachment} />
        </PlaybackPreferencesProvider>
      )

      const video = container.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video).toHaveAttribute(
        'poster',
        'https://example.com/animation-poster.jpg'
      )
      expect(video).toHaveAttribute('loop')
      expect(video?.muted).toBe(true)
      expect(video).toHaveAttribute('playsinline')
      expect(video).not.toHaveAttribute('controls')
    })

    it('autoplays GIFV when autoplayGifs preference is enabled', async () => {
      const playSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(async () => {})
      const onPlayStateChange = vi.fn()

      await act(async () => {
        render(
          <PlaybackPreferencesProvider initialAutoplayGifs={true}>
            <Media
              attachment={gifvAttachment}
              onPlayStateChange={onPlayStateChange}
            />
          </PlaybackPreferencesProvider>
        )
      })

      expect(playSpy).toHaveBeenCalled()
      await vi.waitFor(() => {
        expect(onPlayStateChange).toHaveBeenCalledWith(true)
      })
    })

    it('remains paused when autoplayGifs preference is disabled', () => {
      const playSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(async () => {})

      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <Media attachment={gifvAttachment} />
        </PlaybackPreferencesProvider>
      )

      expect(playSpy).not.toHaveBeenCalled()
    })

    it('respects allowAutoplay=false even when autoplay preference is enabled', () => {
      const playSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(async () => {})

      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={true}>
          <Media attachment={gifvAttachment} allowAutoplay={false} />
        </PlaybackPreferencesProvider>
      )

      expect(playSpy).not.toHaveBeenCalled()
    })

    it('plays on manual override even when autoplay preference is disabled', async () => {
      const playSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(async () => {})
      const onPlayStateChange = vi.fn()

      await act(async () => {
        render(
          <PlaybackPreferencesProvider initialAutoplayGifs={false}>
            <Media
              attachment={gifvAttachment}
              manuallyPaused={false}
              onPlayStateChange={onPlayStateChange}
            />
          </PlaybackPreferencesProvider>
        )
      })

      expect(playSpy).toHaveBeenCalled()
      await vi.waitFor(() => {
        expect(onPlayStateChange).toHaveBeenCalledWith(true)
      })
    })

    it('pauses on manual override even when autoplay preference is enabled', () => {
      const playSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(async () => {})
      const pauseSpy = vi
        .spyOn(HTMLMediaElement.prototype, 'pause')
        .mockImplementation(() => {})

      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={true}>
          <Media attachment={gifvAttachment} manuallyPaused={true} />
        </PlaybackPreferencesProvider>
      )

      expect(playSpy).not.toHaveBeenCalled()
      expect(pauseSpy).toHaveBeenCalled()
    })

    it('handles video.play() rejection gracefully without throwing', async () => {
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
        new Error('Autoplay blocked')
      )
      const onPlayStateChange = vi.fn()

      await act(async () => {
        render(
          <PlaybackPreferencesProvider initialAutoplayGifs={true}>
            <Media
              attachment={gifvAttachment}
              onPlayStateChange={onPlayStateChange}
            />
          </PlaybackPreferencesProvider>
        )
      })

      await vi.waitFor(() => {
        expect(onPlayStateChange).toHaveBeenCalledWith(false)
      })
    })

    it('renders static preview for paused image/gif when autoplay is disabled', () => {
      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <Media attachment={gifAttachment} />
        </PlaybackPreferencesProvider>
      )

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'https://example.com/static-thumb.png')
    })

    it('renders animated image/gif when autoplay is enabled', () => {
      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={true}>
          <Media attachment={gifAttachment} />
        </PlaybackPreferencesProvider>
      )

      const img = screen.getByRole('img')
      expect(img).toHaveAttribute('src', 'https://example.com/animated.gif')
    })

    it('does not autoplay when prefers-reduced-motion is reduce', () => {
      const originalMatchMedia = window.matchMedia
      try {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn()
        }))
        const playSpy = vi
          .spyOn(HTMLMediaElement.prototype, 'play')
          .mockImplementation(async () => {})

        render(
          <PlaybackPreferencesProvider initialAutoplayGifs={true}>
            <Media attachment={gifvAttachment} />
          </PlaybackPreferencesProvider>
        )

        expect(playSpy).not.toHaveBeenCalled()
      } finally {
        window.matchMedia = originalMatchMedia
      }
    })

    it('renders accessible container with role=img and aria-label for paused GIF with only blurhash', () => {
      const gifWithoutThumbnail: Attachment = {
        ...baseAttachment,
        mediaType: 'image/gif',
        url: 'https://example.com/animation.gif',
        blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
        name: 'Cool animation'
      }

      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <Media attachment={gifWithoutThumbnail} />
        </PlaybackPreferencesProvider>
      )

      const placeholder = screen.getByRole('img', { name: 'Cool animation' })
      expect(placeholder).toBeInTheDocument()
      expect(screen.getByTestId('blurhash-canvas')).toBeInTheDocument()
    })

    it('pauses playback when element is not intersecting the viewport', async () => {
      let observerCallback: (
        entries: IntersectionObserverEntry[]
      ) => void = () => {}
      const observeFn = vi.fn()
      const disconnectFn = vi.fn()

      class MockIntersectionObserver {
        constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
          observerCallback = callback
        }
        observe = observeFn
        disconnect = disconnectFn
        unobserve = vi.fn()
        takeRecords = vi.fn()
        root = null
        rootMargin = ''
        thresholds = [0]
      }

      const originalIntersectionObserver = window.IntersectionObserver
      window.IntersectionObserver =
        MockIntersectionObserver as unknown as typeof IntersectionObserver

      try {
        const playSpy = vi
          .spyOn(HTMLMediaElement.prototype, 'play')
          .mockImplementation(async () => {})
        const pauseSpy = vi
          .spyOn(HTMLMediaElement.prototype, 'pause')
          .mockImplementation(() => {})

        await act(async () => {
          render(
            <PlaybackPreferencesProvider initialAutoplayGifs={true}>
              <Media attachment={gifvAttachment} />
            </PlaybackPreferencesProvider>
          )
        })

        expect(observeFn).toHaveBeenCalled()
        expect(playSpy).toHaveBeenCalled()

        // Simulate scrolling out of viewport
        await act(async () => {
          observerCallback([
            {
              isIntersecting: false,
              target: document.createElement('div')
            } as unknown as IntersectionObserverEntry
          ])
        })

        expect(pauseSpy).toHaveBeenCalled()
      } finally {
        window.IntersectionObserver = originalIntersectionObserver
      }
    })
  })
})
