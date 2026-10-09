/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { Attachments } from './attachments'
import {
  BLURHASH,
  buildAttachment,
  buildNoteStatus,
  captionHeights,
  resetAttachmentTestState,
  resizeCallbacks
} from './attachments.testUtils'

beforeEach(() => {
  resetAttachmentTestState()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

    it('renders a short caption underneath without an expansion control', () => {
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

      const caption = screen.getByText('A mountaineer hiking on a ridge')
      expect(caption).toHaveClass('line-clamp-3')
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    })

    it('measures a long caption and allows expanding and collapsing it', () => {
      const description =
        'A detailed description that spans more than three lines'
      captionHeights.set(description, 100)
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({
              width: 800,
              height: 600,
              name: description
            })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      const caption = screen.getByText(description)
      const toggleButton = screen.getByRole('button', { name: 'Show more' })
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
      expect(toggleButton).toHaveAttribute('aria-controls', caption.id)
      expect(caption).toHaveClass('line-clamp-3')

      fireEvent.click(toggleButton)
      expect(toggleButton).toHaveAttribute('aria-expanded', 'true')
      expect(toggleButton).toHaveTextContent('Show less')
      expect(caption).not.toHaveClass('line-clamp-3')

      fireEvent.click(toggleButton)
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false')
      expect(toggleButton).toHaveTextContent('Show more')
      expect(caption).toHaveClass('line-clamp-3')
    })

    it('does not render a caption when name is empty or whitespace', () => {
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
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    })

    it('keeps caption and expansion clicks inside the attachment', () => {
      const parentOnClick = vi.fn()
      const onMediaSelected = vi.fn()
      captionHeights.set('Description', 100)
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
            onMediaSelected={onMediaSelected}
          />
        </div>
      )

      fireEvent.click(screen.getByText('Description'))
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      expect(parentOnClick).not.toHaveBeenCalled()
      expect(onMediaSelected).not.toHaveBeenCalled()
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
      expect(strip.style.minHeight).toBe('240px')
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
        (candidate) => candidate.parentElement?.style.width === expectedWidth
      )
      expect(button).toBeDefined()
      expect(button?.parentElement?.style.maxWidth).toBe('78%')
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

    it('renders every visual attachment with no item cap', () => {
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
    })

    it('keeps long captions independently expandable', () => {
      const descriptions = ['First long caption', 'Second long caption']
      descriptions.forEach((description) =>
        captionHeights.set(description, 100)
      )
      render(
        <Attachments
          status={buildNoteStatus(
            descriptions.map((name) =>
              buildAttachment({ width: 800, height: 600, name })
            )
          )}
          onMediaSelected={vi.fn()}
        />
      )

      const [firstToggle, secondToggle] = screen.getAllByRole('button', {
        name: 'Show more'
      })
      fireEvent.click(firstToggle)

      expect(firstToggle).toHaveTextContent('Show less')
      expect(secondToggle).toHaveTextContent('Show more')
      expect(screen.getByText(descriptions[0])).not.toHaveClass('line-clamp-3')
      expect(screen.getByText(descriptions[1])).toHaveClass('line-clamp-3')

      fireEvent.click(firstToggle)
      expect(firstToggle).toHaveTextContent('Show more')
      expect(screen.getByText(descriptions[0])).toHaveClass('line-clamp-3')
    })

    it('adds and removes the expansion control after an actual resize', () => {
      const description = 'Caption whose wrapping changes with the card width'
      captionHeights.set(description, 40)
      render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ width: 800, height: 600, name: description }),
            buildAttachment({ width: 800, height: 600 })
          ])}
          onMediaSelected={vi.fn()}
        />
      )
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()

      captionHeights.set(description, 100)
      act(() => resizeCallbacks.forEach((callback) => callback()))
      expect(
        screen.getByRole('button', { name: 'Show more' })
      ).toBeInTheDocument()

      captionHeights.set(description, 40)
      act(() => resizeCallbacks.forEach((callback) => callback()))
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    })

    it('renders no captions when none have descriptions', () => {
      const first = buildAttachment({ width: 800, height: 600 })
      const second = buildAttachment({ width: 800, height: 600 })

      render(
        <Attachments
          status={buildNoteStatus([first, second])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(screen.queryByRole('paragraph')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    })

    it('keeps caption and expansion clicks from navigating or opening media', () => {
      const parentOnClick = vi.fn()
      const onMediaSelected = vi.fn()
      captionHeights.set('Cat photo', 100)
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
            onMediaSelected={onMediaSelected}
          />
        </div>
      )

      fireEvent.click(screen.getByText('Cat photo'))
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
      expect(parentOnClick).not.toHaveBeenCalled()
      expect(onMediaSelected).not.toHaveBeenCalled()
    })

    it('resets expansion when a description is replaced', () => {
      const first = buildAttachment({
        id: 'stable-attachment',
        width: 800,
        height: 600,
        name: 'First description'
      })
      const second = buildAttachment({
        width: 800,
        height: 600,
        name: 'Second description'
      })
      captionHeights.set('First description', 100)
      captionHeights.set('Replacement description', 100)

      const { rerender } = render(
        <Attachments
          status={buildNoteStatus([first, second])}
          onMediaSelected={vi.fn()}
        />
      )

      const toggleButton = screen.getByRole('button', { name: 'Show more' })
      fireEvent.click(toggleButton)
      expect(toggleButton).toHaveAttribute('aria-expanded', 'true')
      rerender(
        <Attachments
          status={buildNoteStatus([
            { ...first, name: 'Replacement description' },
            second
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(screen.getByText('Replacement description')).toHaveClass(
        'line-clamp-3'
      )
      expect(screen.getByRole('button', { name: 'Show more' })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
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

  it('renders custom emoji images in a single-image caption', () => {
    const status = {
      ...buildNoteStatus([
        buildAttachment({
          width: 800,
          height: 600,
          name: 'A photo with :blobcat: emoji'
        })
      ]),
      tags: [
        {
          id: 'tag-1',
          statusId: 'status-1',
          type: 'emoji' as const,
          name: ':blobcat:',
          value: 'https://example.com/blobcat.png',
          createdAt: 0,
          updatedAt: 0
        }
      ]
    }

    render(<Attachments status={status} onMediaSelected={vi.fn()} />)

    const img = screen.getByRole('img', { name: ':blobcat:' })
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'https://example.com/blobcat.png')
    expect(screen.getByText(/A photo with/)).toBeInTheDocument()
  })

  it('renders custom emoji images in each matching strip caption', () => {
    const status = {
      ...buildNoteStatus([
        buildAttachment({
          id: 'att-1',
          width: 800,
          height: 600,
          name: 'First :blobcat:'
        }),
        buildAttachment({
          id: 'att-2',
          width: 800,
          height: 600,
          name: 'Second :blobcat:'
        })
      ]),
      tags: [
        {
          id: 'tag-1',
          statusId: 'status-1',
          type: 'emoji' as const,
          name: ':blobcat:',
          value: 'https://example.com/blobcat.png',
          createdAt: 0,
          updatedAt: 0
        }
      ]
    }

    render(<Attachments status={status} onMediaSelected={vi.fn()} />)

    const imgs = screen.getAllByRole('img', { name: ':blobcat:' })
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toHaveAttribute('src', 'https://example.com/blobcat.png')
  })

  it('preserves caption line breaks', () => {
    render(
      <Attachments
        status={buildNoteStatus([
          buildAttachment({
            width: 800,
            height: 600,
            name: 'First line\nSecond line'
          })
        ])}
        onMediaSelected={vi.fn()}
      />
    )

    const caption = screen.getByText(/First line/)
    expect(caption.textContent).toBe('First line\nSecond line')
  })
})
