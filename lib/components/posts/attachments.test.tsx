/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { Attachment } from '@/lib/types/domain/attachment'
import { Status, StatusNote, StatusType } from '@/lib/types/domain/status'

import { Attachments, buildEdgeFadeMask } from './attachments'

// jsdom has no ResizeObserver. useMediaStripScroll already no-ops when it is
// undefined, but the strip still calls `measure()` eagerly on mount, so a
// stub keeps that path exercised the same way it would run in a browser.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

let attachmentSequence = 0

const buildAttachment = (overrides: Partial<Attachment> = {}): Attachment => {
  attachmentSequence += 1
  return {
    id: `attachment-${attachmentSequence}`,
    actorId: 'https://activities.local/users/llun',
    statusId: 'https://activities.local/users/llun/statuses/post-1',
    type: 'Document',
    mediaType: 'image/jpeg',
    url: `https://activities.local/media/${attachmentSequence}.jpg`,
    name: '',
    createdAt: currentTime,
    updatedAt: currentTime,
    ...overrides
  }
}

const buildNoteStatus = (attachments: Attachment[]): StatusNote => ({
  id: 'https://activities.local/users/llun/statuses/post-1',
  actorId: 'https://activities.local/users/llun',
  actor: {
    id: 'https://activities.local/users/llun',
    username: 'llun',
    domain: 'activities.local',
    name: 'Llun',
    followersUrl: 'https://activities.local/users/llun/followers',
    inboxUrl: 'https://activities.local/users/llun/inbox',
    sharedInboxUrl: 'https://activities.local/inbox',
    followingCount: 0,
    followersCount: 0,
    statusCount: 0,
    lastStatusAt: null,
    createdAt: currentTime
  },
  to: [],
  cc: [],
  edits: [],
  isLocalActor: true,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Note,
  url: 'https://activities.local/@llun/post-1',
  text: 'Status text',
  summary: null,
  reply: '',
  replies: [],
  actorAnnounceStatusId: null,
  isActorLiked: false,
  isActorBookmarked: false,
  totalLikes: 0,
  totalShares: 0,
  attachments,
  tags: []
})

const buildAnnounceStatus = (originalStatus: StatusNote): Status => ({
  id: 'https://remote.example/users/booster/statuses/boost-1/activity',
  actorId: 'https://remote.example/users/booster',
  actor: null,
  to: [],
  cc: [],
  edits: [],
  isLocalActor: false,
  createdAt: currentTime,
  updatedAt: currentTime,
  type: StatusType.enum.Announce,
  originalStatus
})

describe('Attachments', () => {
  describe('a single image', () => {
    it.each([
      {
        description: 'scales a landscape image down to the row height',
        width: 800,
        height: 600,
        expectedAspectRatio: '800 / 600',
        expectedWidth: 'min(100%, 560px)'
      },
      {
        description: 'never upscales a small image past its own pixels',
        width: 200,
        height: 150,
        expectedAspectRatio: '200 / 150',
        expectedWidth: 'min(100%, 200px)'
      },
      {
        description: 'falls back to a 4/3 box when neither dimension is known',
        width: undefined,
        height: undefined,
        expectedAspectRatio: '4 / 3',
        expectedWidth: 'min(100%, 560px)'
      }
    ])(
      '$description',
      ({ width, height, expectedAspectRatio, expectedWidth }) => {
        const attachment = buildAttachment({ width, height })
        render(
          <Attachments
            status={buildNoteStatus([attachment])}
            onMediaSelected={vi.fn()}
          />
        )

        const button = screen.getByRole('button')
        expect(button.style.aspectRatio).toBe(expectedAspectRatio)
        expect(button.style.width).toBe(expectedWidth)
        expect(button.parentElement).toHaveClass('flex', 'justify-start')
      }
    )

    it.each([
      {
        description:
          'treats a stored zero width as unknown, not as zero pixels',
        width: 0,
        height: 0
      },
      {
        description: 'treats negative dimensions as unknown',
        width: -800,
        height: -600
      }
    ])('$description', ({ width, height }) => {
      // Several media-storage paths persist `metaData.width ?? 0`, so a real
      // attachment can carry 0. Reading it raw collapsed the box to 0x0 and the
      // photo vanished from the post.
      render(
        <Attachments
          status={buildNoteStatus([buildAttachment({ width, height })])}
          onMediaSelected={vi.fn()}
        />
      )

      const button = screen.getByRole('button')
      expect(button.style.aspectRatio).toBe('4 / 3')
      expect(button.style.width).toBe('min(100%, 560px)')
    })

    it.each([
      {
        description: 'clamps a sliver taller than 3:1 instead of rounding to 0',
        width: 10,
        height: 10000,
        // The clamped ratio would give 140px, but 10 native pixels cap it and
        // the target-size floor takes over from there.
        expectedWidth: 'min(100%, 44px)'
      },
      {
        description: 'clamps a panorama wider than 3:1',
        width: 10000,
        height: 10,
        expectedWidth: 'min(100%, 1260px)'
      }
    ])('$description', ({ width, height, expectedWidth }) => {
      render(
        <Attachments
          status={buildNoteStatus([buildAttachment({ width, height })])}
          onMediaSelected={vi.fn()}
        />
      )

      const button = screen.getByRole('button')
      expect(button.style.width).toBe(expectedWidth)
      // The declared shape has to be the clamped one, or the width and the
      // aspect ratio would describe different boxes.
      expect(button.style.aspectRatio).not.toBe(`${width} / ${height}`)
    })

    it('keeps a tiny image large enough to be a usable target', () => {
      render(
        <Attachments
          status={buildNoteStatus([buildAttachment({ width: 1, height: 1 })])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(screen.getByRole('button').style.width).toBe('min(100%, 44px)')
    })

    it('loads a lone picture eagerly, as the largest element on the post', () => {
      const { container } = render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(container.querySelector('img')).not.toHaveAttribute('loading')
    })

    it('renders no scroll strip', () => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(screen.queryByRole('group')).not.toBeInTheDocument()
      expect(
        screen.queryByLabelText(/media attachments/)
      ).not.toBeInTheDocument()
    })
  })

  describe('two or more images', () => {
    const buildThreeImages = () => [
      buildAttachment({ width: 800, height: 600 }),
      buildAttachment({ width: 600, height: 900 }),
      buildAttachment({ width: 1200, height: 500 })
    ]

    it('renders a labelled scroll strip', () => {
      render(
        <Attachments
          status={buildNoteStatus(buildThreeImages())}
          onMediaSelected={vi.fn()}
        />
      )

      const strip = screen.getByRole('group', { name: '3 media attachments' })
      expect(strip).toHaveClass('no-scrollbar', 'overflow-x-auto')
      expect(strip.style.height).toBe('240px')
      expect(strip.style.scrollSnapType).toBe('x proximity')
    })

    it.each([
      {
        description: '800x600 rounds to 320px',
        width: 800,
        height: 600,
        expectedWidth: '320px'
      },
      {
        description: '600x900 rounds to 160px',
        width: 600,
        height: 900,
        expectedWidth: '160px'
      },
      {
        description: '1200x500 rounds to 576px',
        width: 1200,
        height: 500,
        expectedWidth: '576px'
      }
    ])('$description', ({ width, height, expectedWidth }) => {
      const target = buildAttachment({ width, height })
      // A second attachment is required to enter the strip layout at all.
      const filler = buildAttachment({ width: 800, height: 600 })
      render(
        <Attachments
          status={buildNoteStatus([target, filler])}
          onMediaSelected={vi.fn()}
        />
      )

      const buttons = screen.getAllByRole('button')
      const button = buttons.find(
        (candidate) => candidate.style.width === expectedWidth
      )
      expect(button).toBeDefined()
      expect(button?.style.maxWidth).toBe('78%')
      expect(button?.style.scrollSnapAlign).toBe('start')
    })

    it('lazy-loads strip images, which are now uncapped', () => {
      const { container } = render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      const images = Array.from(container.querySelectorAll('img'))
      expect(images).toHaveLength(2)
      images.forEach((image) =>
        expect(image).toHaveAttribute('loading', 'lazy')
      )
    })

    it('renders every attachment with no cap and no overlay', () => {
      const attachments = Array.from({ length: 7 }, () =>
        buildAttachment({ width: 800, height: 600 })
      )
      render(
        <Attachments
          status={buildNoteStatus(attachments)}
          onMediaSelected={vi.fn()}
        />
      )

      expect(screen.getAllByRole('button')).toHaveLength(7)
      expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument()
    })
  })

  it('hands the lightbox exactly the pictures on screen, indexed into that list', () => {
    // Anything the strip skipped renders as nothing, so passing it on would
    // give the modal a blank slide, an empty thumbnail and a wrong "n of m".
    const audio = buildAttachment({ mediaType: 'audio/mpeg' })
    const fitnessFile = buildAttachment({
      mediaType: 'application/vnd.ant.fit'
    })
    const firstImage = buildAttachment({ width: 800, height: 600 })
    const secondImage = buildAttachment({ width: 800, height: 600 })
    const onMediaSelected = vi.fn()

    render(
      <Attachments
        status={buildNoteStatus([audio, fitnessFile, firstImage, secondImage])}
        onMediaSelected={onMediaSelected}
      />
    )

    const [firstRenderedButton] = screen.getAllByRole('button')
    fireEvent.click(firstRenderedButton)

    expect(onMediaSelected).toHaveBeenCalledWith([firstImage, secondImage], 0)
  })

  describe('audio attachments', () => {
    it('renders as left-aligned audio players outside the picture strip', () => {
      const audio = buildAttachment({ mediaType: 'audio/mpeg' })
      const { container } = render(
        <Attachments
          status={buildNoteStatus([audio])}
          onMediaSelected={vi.fn()}
        />
      )

      const audioElement = container.querySelector('audio')
      expect(audioElement).toBeInTheDocument()
      expect(audioElement?.parentElement).toHaveClass('flex', 'items-start')
      expect(screen.queryByRole('group')).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('attachments Media cannot render', () => {
    it('renders nothing when the only attachment is unsupported', () => {
      const fitnessFile = buildAttachment({
        mediaType: 'application/vnd.ant.fit'
      })
      const { container } = render(
        <Attachments
          status={buildNoteStatus([fitnessFile])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(container).toBeEmptyDOMElement()
    })

    it('is skipped rather than producing an empty box alongside a real image', () => {
      const fitnessFile = buildAttachment({
        mediaType: 'application/vnd.ant.fit'
      })
      const image = buildAttachment({ width: 800, height: 600 })
      render(
        <Attachments
          status={buildNoteStatus([fitnessFile, image])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(screen.getAllByRole('button')).toHaveLength(1)
    })
  })

  describe('scroll affordances', () => {
    // jsdom lays nothing out, so the strip's geometry has to be stamped on and
    // a scroll event fired to put the component into a scrolled state.
    const renderScrolledStrip = ({ scrollLeft }: { scrollLeft: number }) => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )
      const strip = screen.getByRole('group')
      Object.defineProperty(strip, 'scrollWidth', {
        configurable: true,
        value: 1000
      })
      Object.defineProperty(strip, 'clientWidth', {
        configurable: true,
        value: 500
      })
      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        value: scrollLeft
      })
      fireEvent.scroll(strip)
      return strip
    }

    it('promises more media only once there is more to reach', () => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      // jsdom lays nothing out, so nothing overflows and the label must not
      // tell a screen-reader user to scroll to content that is not there.
      expect(
        screen.getByRole('group', { name: '2 media attachments' })
      ).toBeInTheDocument()
    })

    it('promises more media once the strip overflows', () => {
      renderScrolledStrip({ scrollLeft: 0 })

      expect(
        screen.getByRole('group', {
          name: '3 media attachments, scroll for more'
        })
      ).toBeInTheDocument()
    })

    it('shows only the forward chevron before the strip has been scrolled', () => {
      renderScrolledStrip({ scrollLeft: 0 })

      expect(
        screen.getByRole('button', { name: 'More media' })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Previous media' })
      ).not.toBeInTheDocument()
    })

    it('keeps the hidden back chevron from swallowing taps on the leftmost photo', () => {
      // `opacity-0` alone still hit-tests, and `group-hover` never latches on a
      // touch screen, so without `pointer-events-none` the invisible Previous
      // button sits over the leftmost image as a dead column.
      renderScrolledStrip({ scrollLeft: 250 })

      const back = screen.getByRole('button', { name: 'Previous media' })
      expect(back).toHaveClass('opacity-0', 'pointer-events-none')
      expect(back).toHaveClass(
        'group-hover/media:opacity-100',
        'group-hover/media:pointer-events-auto'
      )
    })

    it('keeps both chevrons out of the tab order', () => {
      // Each is unmounted by the scroll it performs, so a focused one would
      // drop focus to <body>; the picture buttons are the keyboard path.
      renderScrolledStrip({ scrollLeft: 250 })

      expect(
        screen.getByRole('button', { name: 'Previous media' })
      ).toHaveAttribute('tabindex', '-1')
      expect(
        screen.getByRole('button', { name: 'More media' })
      ).toHaveAttribute('tabindex', '-1')
    })

    it('nudges by 70% of the visible width', () => {
      const strip = renderScrolledStrip({ scrollLeft: 0 })
      const scrollBy = vi.fn()
      Object.defineProperty(strip, 'scrollBy', {
        configurable: true,
        value: scrollBy
      })

      fireEvent.click(screen.getByRole('button', { name: 'More media' }))

      expect(scrollBy).toHaveBeenCalledWith({ left: 350, behavior: 'smooth' })
    })
  })

  describe('accessible names', () => {
    it.each([
      {
        description: 'names a described picture by its description',
        name: 'Sunset over the pier',
        expected: 'Open media: Sunset over the pier'
      },
      {
        description: 'falls back to a position for an undescribed picture',
        name: '',
        expected: 'Open media 1'
      }
    ])('$description', ({ name, expected }) => {
      // Federation writes `attachment.name || ''`, so `Media`'s alt can be
      // empty and the button would otherwise announce as a bare "button".
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600, name })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: expected })).toBeInTheDocument()
    })

    it('names each picture in a strip by its own position', () => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600, name: '' }),
            buildAttachment({ width: 800, height: 600, name: '' })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(
        screen.getByRole('button', { name: 'Open media 1' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Open media 2' })
      ).toBeInTheDocument()
    })
  })

  describe('buildEdgeFadeMask', () => {
    it.each([
      {
        description: 'paints no mask while nothing is out of view',
        canScrollLeft: false,
        canScrollRight: false,
        expected: undefined
      },
      {
        description: 'fades only the right edge at the start of the strip',
        canScrollLeft: false,
        canScrollRight: true,
        expected:
          'linear-gradient(to right, #000 0, #000 calc(100% - 48px), transparent 100%)'
      },
      {
        description: 'fades only the left edge at the end of the strip',
        canScrollLeft: true,
        canScrollRight: false,
        expected:
          'linear-gradient(to right, transparent 0, #000 48px, #000 100%)'
      },
      {
        description: 'fades both edges in the middle of the strip',
        canScrollLeft: true,
        canScrollRight: true,
        expected:
          'linear-gradient(to right, transparent 0, #000 48px, #000 calc(100% - 48px), transparent 100%)'
      }
    ])('$description', ({ canScrollLeft, canScrollRight, expected }) => {
      expect(buildEdgeFadeMask(canScrollLeft, canScrollRight)).toBe(expected)
    })
  })

  it('renders nothing for a non-Note status', () => {
    const announce = buildAnnounceStatus(
      buildNoteStatus([buildAttachment({ width: 800, height: 600 })])
    )
    const { container } = render(
      <Attachments status={announce} onMediaSelected={vi.fn()} />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('stops the click from reaching an ancestor click handler', () => {
    const parentOnClick = vi.fn()
    render(
      <div onClick={parentOnClick}>
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      </div>
    )

    fireEvent.click(screen.getByRole('button'))

    expect(parentOnClick).not.toHaveBeenCalled()
  })
})
