/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'

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

// Enough for `Media` to take its blurhash branch, which is the one every
// locally uploaded image actually renders through.
const BLURHASH = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'

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
      },
      {
        description: 'treats a missing width alone as unknown',
        width: undefined,
        height: 600
      },
      {
        description: 'treats a missing height alone as unknown',
        width: 800,
        height: undefined
      },
      {
        description: 'treats a negative width alone as unknown',
        width: -800,
        height: 600
      },
      {
        description: 'treats a negative height alone as unknown',
        width: 800,
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
        description: 'lays a clamped sliver out at the 1:3 floor, not narrower',
        // Wide enough that the natural-width cap and the target-size floor
        // both stay out of the way, so the clamp's own value is what shows.
        width: 400,
        height: 10000,
        expectedWidth: 'min(100%, 140px)'
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

    it.each([
      { description: 'a plain image', blurhash: undefined },
      {
        description: 'an image with a blurhash placeholder',
        blurhash: BLURHASH
      }
    ])(
      'loads $description eagerly when alone, being the largest element',
      ({ blurhash }) => {
        const { container } = render(
          <Attachments
            status={buildNoteStatus([
              buildAttachment({ width: 800, height: 600, blurhash })
            ])}
            onMediaSelected={vi.fn()}
          />
        )

        expect(container.querySelector('img')).not.toHaveAttribute('loading')
      }
    )

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

    it('renders subtle alt text underneath a single image when name is provided', () => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({
              width: 800,
              height: 600,
              name: 'A mountaineer hiking on a ridge'
            })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      const alt = screen.getByText('A mountaineer hiking on a ridge')
      expect(alt).toBeInTheDocument()
      expect(alt).toHaveClass('text-muted-foreground', 'text-sm')
      // Single image should not render an ALT badge
      expect(screen.queryByText(/ALT/)).not.toBeInTheDocument()
    })

    it('does not render alt text underneath when name is empty or whitespace', () => {
      const { container } = render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({
              width: 800,
              height: 600,
              name: '   '
            })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(container.querySelector('p')).not.toBeInTheDocument()
    })

    it('stops click propagation when clicking on the alt text', () => {
      const parentOnClick = vi.fn()
      render(
        <div onClick={parentOnClick}>
          <Attachments
            status={buildNoteStatus([
              buildAttachment({
                width: 800,
                height: 600,
                name: 'Description'
              })
            ])}
            onMediaSelected={vi.fn()}
          />
        </div>
      )

      fireEvent.click(screen.getByText('Description'))
      expect(parentOnClick).not.toHaveBeenCalled()
    })
  })

  describe('two or more images', () => {
    const buildThreeImages = () => [
      buildAttachment({ width: 800, height: 600 }),
      buildAttachment({ width: 600, height: 900 }),
      buildAttachment({ width: 1200, height: 500 })
    ]

    it('lays items out at their own width instead of letting them shrink', () => {
      // `flex-none` is the single declaration that makes the strip overflow.
      // Without it the default flex-shrink squeezes every item to fit, so
      // scrollWidth === clientWidth forever: no chevrons, no fade, no peek, no
      // scrolling, and every photo cropped. jsdom lays nothing out, so the
      // class itself is what can be pinned here.
      render(
        <Attachments
          status={buildNoteStatus(buildThreeImages())}
          onMediaSelected={vi.fn()}
        />
      )

      screen
        .getAllByRole('button')
        .forEach((item) => expect(item).toHaveClass('flex-none'))
    })

    it('crops rather than letterboxes, which the ratio clamp relies on', () => {
      const { container } = render(
        <Attachments
          status={buildNoteStatus(buildThreeImages())}
          onMediaSelected={vi.fn()}
        />
      )

      Array.from(container.querySelectorAll('img')).forEach((image) =>
        expect(image).toHaveClass('object-cover')
      )
    })

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
      // A second attachment is required to enter the strip layout at all. Its
      // shape is distinct from every row's so the width lookup below can only
      // ever match the target.
      const filler = buildAttachment({ width: 400, height: 400 })
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

    // Both branches of `Media`: a locally uploaded image always carries a
    // blurhash, so asserting only the plain <img> would pin the branch
    // production does not take.
    it.each([
      { description: 'a plain image', blurhash: undefined },
      {
        description: 'an image with a blurhash placeholder',
        blurhash: BLURHASH
      }
    ])('lazy-loads $description in the uncapped strip', ({ blurhash }) => {
      const { container } = render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600, blurhash }),
            buildAttachment({ width: 800, height: 600, blurhash })
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

    it('renders ALT badges and numbered alt text list for multiple images with descriptions', () => {
      const first = buildAttachment({
        width: 800,
        height: 600,
        name: 'First cat eating'
      })
      const second = buildAttachment({
        width: 600,
        height: 900,
        name: 'Second cat resting'
      })
      const third = buildAttachment({
        width: 1200,
        height: 500,
        name: ''
      })

      render(
        <Attachments
          status={buildNoteStatus([first, second, third])}
          onMediaSelected={vi.fn()}
        />
      )

      // First and second have alt text -> ALT¹ and ALT² badges
      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName.toLowerCase() === 'span' &&
            element.textContent === 'ALT1'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName.toLowerCase() === 'span' &&
            element.textContent === 'ALT2'
        )
      ).toBeInTheDocument()
      // Third has no alt text -> no ALT³ badge
      expect(
        screen.queryByText(
          (_content, element) =>
            element?.tagName.toLowerCase() === 'span' &&
            element.textContent === 'ALT3'
        )
      ).not.toBeInTheDocument()

      // Numbered alt text list underneath
      expect(screen.getByText('First cat eating')).toBeInTheDocument()
      expect(screen.getByText('Second cat resting')).toBeInTheDocument()
    })

    it('groups indices when multiple images share identical alt text', () => {
      const first = buildAttachment({
        width: 800,
        height: 600,
        name: 'Same landscape view'
      })
      const second = buildAttachment({
        width: 600,
        height: 900,
        name: 'Same landscape view'
      })

      render(
        <Attachments
          status={buildNoteStatus([first, second])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName.toLowerCase() === 'span' &&
            element.textContent === 'ALT1'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          (_content, element) =>
            element?.tagName.toLowerCase() === 'span' &&
            element.textContent === 'ALT2'
        )
      ).toBeInTheDocument()

      // The grouped item shows indices "1 2" together
      expect(screen.getByText('1 2')).toBeInTheDocument()
      expect(screen.getByText('Same landscape view')).toBeInTheDocument()
    })

    it('does not render alt text section or badges if none have descriptions', () => {
      const first = buildAttachment({ width: 800, height: 600 })
      const second = buildAttachment({ width: 800, height: 600 })

      render(
        <Attachments
          status={buildNoteStatus([first, second])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(screen.queryByText(/ALT/)).not.toBeInTheDocument()
    })

    it('stops click propagation when clicking on the alt text list item', () => {
      const parentOnClick = vi.fn()
      const first = buildAttachment({
        width: 800,
        height: 600,
        name: 'Cat photo'
      })
      const second = buildAttachment({
        width: 800,
        height: 600,
        name: 'Dog photo'
      })

      render(
        <div onClick={parentOnClick}>
          <Attachments
            status={buildNoteStatus([first, second])}
            onMediaSelected={vi.fn()}
          />
        </div>
      )

      fireEvent.click(screen.getByText('Cat photo'))
      expect(parentOnClick).not.toHaveBeenCalled()
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

    // The SECOND picture, so a correct index and a hardcoded 0 differ.
    const [, secondRenderedButton] = screen.getAllByRole('button')
    fireEvent.click(secondRenderedButton)

    expect(onMediaSelected).toHaveBeenCalledWith([firstImage, secondImage], 1)
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

  describe('video attachments', () => {
    it('lays a video out in the strip like any other picture', () => {
      const { container } = render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({
              mediaType: 'video/mp4',
              width: 1200,
              height: 500
            }),
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      const [video] = screen.getAllByRole('button')
      expect(video.style.width).toBe('576px')
      expect(container.querySelector('video')).toBeInTheDocument()
    })

    it('defers a strip video that has a poster to paint instead', () => {
      // `loading` is image-only, so an unbounded strip of videos would
      // otherwise be one metadata range request per clip.
      const { container } = render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({
              mediaType: 'video/mp4',
              width: 800,
              height: 600,
              thumbnailUrl: 'https://activities.local/media/poster-1.jpg'
            }),
            buildAttachment({
              mediaType: 'video/mp4',
              width: 800,
              height: 600,
              thumbnailUrl: 'https://activities.local/media/poster-2.jpg'
            })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      const videos = Array.from(container.querySelectorAll('video'))
      expect(videos).toHaveLength(2)
      videos.forEach((video) =>
        expect(video).toHaveAttribute('preload', 'none')
      )
    })

    it('does not defer a posterless strip video, which would show nothing', () => {
      // Federated video never carries a thumbnail — only the local-upload path
      // writes one — so its sole pre-playback frame comes from the `#t=0.01`
      // fragment, which needs metadata. Deferring it leaves an empty box.
      const { container } = render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({
              mediaType: 'video/mp4',
              width: 800,
              height: 600
            }),
            buildAttachment({ mediaType: 'video/mp4', width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      const videos = Array.from(container.querySelectorAll('video'))
      expect(videos).toHaveLength(2)
      videos.forEach((video) => expect(video).not.toHaveAttribute('preload'))
    })

    it('does not defer a lone video, the largest element on the post', () => {
      const { container } = render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ mediaType: 'video/mp4', width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(container.querySelector('video')).not.toHaveAttribute('preload')
    })
  })

  describe('a picture alongside audio', () => {
    it('renders both, the picture in its own box and the audio as a player', () => {
      const image = buildAttachment({ width: 800, height: 600 })
      const audio = buildAttachment({ mediaType: 'audio/mpeg' })
      const { container } = render(
        <Attachments
          status={buildNoteStatus([image, audio])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(screen.getAllByRole('button')).toHaveLength(1)
      expect(container.querySelector('audio')).toBeInTheDocument()
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

    it('re-measures when an edit changes item widths but not their count', () => {
      // The hook is keyed on the laid-out WIDTHS for exactly this case: the
      // observer watches the container, which does not resize, the count is
      // unchanged, and scrollLeft stays 0 — so a count-keyed effect would never
      // re-run and the forward chevron would sit over a strip that now fits.
      const panorama = buildAttachment({ width: 1200, height: 500 })
      const portrait = buildAttachment({ width: 600, height: 900 })
      const replacement = buildAttachment({ width: 600, height: 900 })
      const { rerender } = render(
        <Attachments
          status={buildNoteStatus([panorama, portrait])}
          onMediaSelected={vi.fn()}
        />
      )

      // Geometry behind a getter so the rerender can change it without
      // re-stamping the node React is about to reuse.
      const strip = screen.getByRole('group')
      const geometry = { scrollWidth: 1000 }
      Object.defineProperty(strip, 'scrollWidth', {
        configurable: true,
        get: () => geometry.scrollWidth
      })
      Object.defineProperty(strip, 'clientWidth', {
        configurable: true,
        value: 500
      })
      Object.defineProperty(strip, 'scrollLeft', {
        configurable: true,
        value: 0
      })
      fireEvent.scroll(strip)
      expect(
        screen.getByRole('button', { name: 'More media' })
      ).toBeInTheDocument()

      // 576 + 160 becomes 160 + 160: same two items, and now it all fits.
      geometry.scrollWidth = 400
      rerender(
        <Attachments
          status={buildNoteStatus([replacement, portrait])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(
        screen.queryByRole('button', { name: 'More media' })
      ).not.toBeInTheDocument()
    })

    it('attaches the edge fade to the strip itself', () => {
      // Scrolled fully to the end, so the mask has no calc() stop — that is
      // the one variant jsdom's CSS parser will store and hand back.
      const strip = renderScrolledStrip({ scrollLeft: 500 })

      expect(strip.style.maskImage).toContain('linear-gradient')
      expect(strip.style.maskImage).toContain('48px')
    })

    it.each([
      { description: 'the forward chevron', name: 'More media' },
      { description: 'the back chevron', name: 'Previous media' }
    ])('$description does not take focus from a pointer press', ({ name }) => {
      // tabIndex={-1} only removes it from the SEQUENTIAL tab order; Chrome
      // and Firefox still focus a button on click, and the chevron is
      // unmounted by its own scroll, which would drop focus to <body>.
      renderScrolledStrip({ scrollLeft: 250 })

      const chevron = screen.getByRole('button', { name })
      const event = createEvent.mouseDown(chevron)
      fireEvent(chevron, event)

      expect(event.defaultPrevented).toBe(true)
    })

    it('keeps the forward chevron visible without a pointer', () => {
      // group-hover never latches on a touch screen, so hover-gating this one
      // would make the "there is more" cue permanently invisible there.
      renderScrolledStrip({ scrollLeft: 250 })

      const forward = screen.getByRole('button', { name: 'More media' })
      expect(forward.className).not.toContain('opacity-0')
      expect(forward.className).not.toContain('pointer-events-none')
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

    it.each([
      { description: 'the forward chevron', name: 'More media' },
      { description: 'the back chevron', name: 'Previous media' }
    ])(
      '$description stops its click from reaching an ancestor click handler',
      ({ name }) => {
        // The chevrons sit inside the clickable post row, so a click that
        // escaped would scroll the strip AND navigate away from the timeline.
        const parentOnClick = vi.fn()
        render(
          <div onClick={parentOnClick}>
            <Attachments
              status={buildNoteStatus([
                buildAttachment({ width: 800, height: 600 }),
                buildAttachment({ width: 800, height: 600 }),
                buildAttachment({ width: 800, height: 600 })
              ])}
              onMediaSelected={vi.fn()}
            />
          </div>
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
          value: 250
        })
        Object.defineProperty(strip, 'scrollBy', {
          configurable: true,
          value: vi.fn()
        })
        fireEvent.scroll(strip)

        fireEvent.click(screen.getByRole('button', { name }))

        expect(parentOnClick).not.toHaveBeenCalled()
      }
    )

    it.each([
      {
        description: 'the forward chevron nudges forward by 70% of the strip',
        name: 'More media',
        expectedLeft: 350
      },
      {
        description: 'the back chevron nudges backward by the same amount',
        name: 'Previous media',
        expectedLeft: -350
      }
    ])('$description', ({ name, expectedLeft }) => {
      // Scrolled to the middle so both chevrons are mounted.
      const strip = renderScrolledStrip({ scrollLeft: 250 })
      const scrollBy = vi.fn()
      Object.defineProperty(strip, 'scrollBy', {
        configurable: true,
        value: scrollBy
      })

      fireEvent.click(screen.getByRole('button', { name }))

      expect(scrollBy).toHaveBeenCalledWith({
        left: expectedLeft,
        behavior: 'smooth'
      })
    })
  })

  it('opens the lightbox on the lone picture itself', () => {
    // MediasModal reads initialSelection with no wrapping, so an index past the
    // end throws rather than showing a blank slide.
    const attachment = buildAttachment({ width: 800, height: 600 })
    const onMediaSelected = vi.fn()
    render(
      <Attachments
        status={buildNoteStatus([attachment])}
        onMediaSelected={onMediaSelected}
      />
    )

    fireEvent.click(screen.getByRole('button'))

    expect(onMediaSelected).toHaveBeenCalledWith([attachment], 0)
  })

  describe('focus indicators', () => {
    // This indicator has been got wrong twice — an outset ring clipped by the
    // strip's own overflow, then an inset ring painted underneath the opaque
    // image — so the spelling is pinned rather than left to a future reader.
    it('gives a strip item an outline drawn inside its border box', () => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 }),
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      const [item] = screen.getAllByRole('button')
      expect(item).toHaveClass(
        'focus-visible:outline-2',
        'focus-visible:-outline-offset-2',
        'focus-visible:outline-ring/50'
      )
      // An outset ring would be clipped and an inset one occluded.
      expect(item.className).not.toContain('focus-visible:ring-')
    })

    it('leaves a lone picture the ordinary outset ring', () => {
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      // Not inside an overflow container, so nothing clips it.
      expect(screen.getByRole('button')).toHaveClass(
        'focus-visible:ring-2',
        'focus-visible:ring-ring/50'
      )
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
