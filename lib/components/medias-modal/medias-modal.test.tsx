/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { PlaybackPreferencesProvider } from '@/lib/components/preferences/PlaybackPreferencesContext'
import { Attachment } from '@/lib/types/domain/attachment'

import { MediasModal } from './medias-modal'

const currentTime = new Date('2026-04-26T10:00:00.000Z').getTime()

const buildAttachment = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'attachment-1',
  actorId: 'https://activities.local/users/llun',
  statusId: 'https://activities.local/users/llun/statuses/post-1',
  type: 'Document',
  mediaType: 'image/jpeg',
  url: 'https://activities.local/media/1.jpg',
  name: '',
  createdAt: currentTime,
  updatedAt: currentTime,
  ...overrides
})

describe('MediasModal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const openDetails = () =>
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))

  it('hides the alt text until the Details button is pressed', () => {
    const attachment = buildAttachment({
      name: 'A mountaineer walking along a ridge'
    })

    render(
      <MediasModal
        medias={[attachment]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    expect(
      screen.getByText('A mountaineer walking along a ridge')
    ).not.toBeVisible()
    expect(
      screen.queryByRole('region', { name: 'Photo details' })
    ).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Details' })
    expect(toggle).not.toHaveAttribute('aria-pressed')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const hiddenOverlay = document.getElementById(
      toggle.getAttribute('aria-controls') ?? ''
    )
    expect(hiddenOverlay).toHaveAttribute('hidden')

    openDetails()

    const overlay = screen.getByRole('region', { name: 'Photo details' })
    expect(overlay).toHaveTextContent('A mountaineer walking along a ridge')
    expect(overlay).toHaveAttribute('tabindex', '0')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', overlay.id)

    openDetails()
    expect(
      screen.queryByRole('region', { name: 'Photo details' })
    ).not.toBeInTheDocument()
  })

  it('hides the Details button, keeping its space, when there is nothing to show', () => {
    const attachment = buildAttachment({
      name: '   '
    })

    const { container } = render(
      <MediasModal
        medias={[attachment]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    const toggle = screen.getByText('Details').closest('button')
    expect(toggle).toHaveClass('invisible')
    expect(toggle).toHaveAttribute('aria-hidden', 'true')
    expect(toggle).toHaveAttribute('tabindex', '-1')
    expect(container.querySelector('p')).not.toBeInTheDocument()
    expect(document.querySelector('p')).not.toBeInTheDocument()
  })

  it('keeps one image size cap whatever the photo carries', () => {
    const { rerender } = render(
      <MediasModal
        medias={[buildAttachment({ id: 'a', name: '' })]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )
    const bare = document.querySelectorAll('img')[1].className
    expect(bare).toContain('max-h-[calc(100dvh-6rem)]')

    rerender(
      <MediasModal
        medias={[buildAttachment({ id: 'b', name: 'With alt text' })]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )
    openDetails()
    expect(document.querySelectorAll('img')[1].className).toBe(bare)
  })

  it('uses the same cap for every panel when thumbnails are shown', () => {
    render(
      <MediasModal
        medias={[
          buildAttachment({ id: 'a', name: 'First' }),
          buildAttachment({ id: 'b', name: '' }),
          buildAttachment({ id: 'c', name: 'Third' })
        ]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    const images = Array.from(document.querySelectorAll('.w-\\[300\\%\\] img'))
    expect(images).toHaveLength(3)
    for (const image of images) {
      expect(image).toHaveClass(
        'max-h-[calc(100dvh-11rem)]',
        'md:max-h-[calc(100dvh-12rem)]'
      )
    }
  })

  it('shows the corresponding alt text in the open overlay when navigating between media items', () => {
    const first = buildAttachment({
      id: 'attachment-1',
      name: 'First photo description'
    })
    const second = buildAttachment({
      id: 'attachment-2',
      name: 'Second photo description'
    })

    render(
      <MediasModal
        medias={[first, second]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    openDetails()
    expect(screen.getByText('First photo description')).toBeInTheDocument()

    const secondThumbnail = screen.getByRole('button', {
      name: /Second photo description/i
    })
    fireEvent.click(secondThumbnail)

    expect(screen.getByText('Second photo description')).toBeInTheDocument()
    expect(
      screen.queryByText('First photo description')
    ).not.toBeInTheDocument()
  })

  it('hides the overlay for a photo with nothing to show and shows it again afterwards', () => {
    render(
      <MediasModal
        medias={[
          buildAttachment({ id: 'a', name: 'First' }),
          buildAttachment({ id: 'b', name: '' }),
          buildAttachment({ id: 'c', name: 'Third' })
        ]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    openDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Next media' }))
    expect(
      screen.queryByRole('region', { name: 'Photo details' })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next media' }))
    expect(
      screen.getByRole('region', { name: 'Photo details' })
    ).toHaveTextContent('Third')
  })

  it('closes only the overlay on Escape, and the viewer on the next', () => {
    const onClosed = vi.fn()
    render(
      <MediasModal
        medias={[buildAttachment({ name: 'Ridge' })]}
        initialSelection={0}
        onClosed={onClosed}
      />
    )
    openDetails()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(
      screen.queryByRole('region', { name: 'Photo details' })
    ).not.toBeInTheDocument()
    expect(onClosed).not.toHaveBeenCalled()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('closes only the overlay when the backdrop is clicked, and the viewer on the next click', () => {
    const onClosed = vi.fn()
    render(
      <MediasModal
        medias={[buildAttachment({ name: 'Ridge' })]}
        initialSelection={0}
        onClosed={onClosed}
      />
    )
    openDetails()
    const backdrop = screen.getByRole('dialog', { name: 'Media viewer' })

    fireEvent.click(backdrop)
    expect(
      screen.queryByRole('region', { name: 'Photo details' })
    ).not.toBeInTheDocument()
    expect(onClosed).not.toHaveBeenCalled()

    fireEvent.click(backdrop)
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('does not close the viewer when the overlay or the Details button is clicked', () => {
    const onClosed = vi.fn()
    render(
      <MediasModal
        medias={[buildAttachment({ name: 'Ridge' })]}
        initialSelection={0}
        onClosed={onClosed}
      />
    )
    openDetails()

    fireEvent.click(screen.getByText('Ridge'))
    fireEvent.click(screen.getByRole('region', { name: 'Photo details' }))

    expect(onClosed).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Photo details' })).toBeVisible()
  })

  it('starts with the overlay hidden again when reopened with other medias', () => {
    const modalFor = (medias: Attachment[] | null) => (
      <MediasModal medias={medias} initialSelection={0} onClosed={vi.fn()} />
    )
    const { rerender } = render(modalFor([buildAttachment({ name: 'Ridge' })]))
    openDetails()
    expect(screen.getByRole('region', { name: 'Photo details' })).toBeVisible()

    rerender(modalFor(null))
    rerender(modalFor([buildAttachment({ name: 'Ridge' })]))

    expect(
      screen.queryByRole('region', { name: 'Photo details' })
    ).not.toBeInTheDocument()
  })

  it('marks off-screen carousel panels as aria-hidden and active panel as visible', () => {
    const attachment = buildAttachment({
      name: 'Ridge view'
    })

    render(
      <MediasModal
        medias={[attachment]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    const panels = document.body.querySelectorAll('.w-\\[300\\%\\] > div')
    expect(panels[0]).toHaveAttribute('aria-hidden', 'true')
    expect(panels[1]).toHaveAttribute('aria-hidden', 'false')
    expect(panels[2]).toHaveAttribute('aria-hidden', 'true')
  })

  describe('swiping', () => {
    const renderThree = () => {
      render(
        <MediasModal
          medias={[
            buildAttachment({ id: 'a', name: 'Touch description' }),
            buildAttachment({ id: 'b' }),
            buildAttachment({ id: 'c' })
          ]}
          initialSelection={0}
          onClosed={vi.fn()}
        />
      )
      openDetails()
    }
    const swipe = (element: Element) => {
      fireEvent.touchStart(element, { touches: [{ clientX: 300 }] })
      fireEvent.touchMove(element, { touches: [{ clientX: 100 }] })
      fireEvent.touchEnd(element)
      const track = document.querySelector<HTMLElement>(
        '[style*="translateX"]'
      )!
      fireEvent.transitionEnd(track)
    }

    it('does not change the photo when the swipe is on the overlay', () => {
      renderThree()

      swipe(screen.getByText('Touch description'))

      expect(screen.getByText('1 / 3')).toBeInTheDocument()
    })

    it('changes the photo when the same swipe is on the photo', () => {
      renderThree()

      swipe(document.querySelectorAll('img')[1])

      expect(screen.getByText('2 / 3')).toBeInTheDocument()
    })
  })

  describe('focus', () => {
    it('moves focus to the Details button when Escape closes the overlay', () => {
      render(
        <MediasModal
          medias={[buildAttachment({ name: 'Ridge' })]}
          initialSelection={0}
          onClosed={vi.fn()}
        />
      )
      openDetails()
      const overlay = screen.getByRole('region', { name: 'Photo details' })
      overlay.focus()
      expect(overlay).toHaveFocus()

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus()
    })

    it('moves focus to the Details button when the backdrop closes the overlay', () => {
      render(
        <MediasModal
          medias={[buildAttachment({ name: 'Ridge' })]}
          initialSelection={0}
          onClosed={vi.fn()}
        />
      )
      openDetails()
      screen.getByRole('region', { name: 'Photo details' }).focus()

      fireEvent.click(screen.getByRole('dialog', { name: 'Media viewer' }))

      expect(screen.getByRole('button', { name: 'Details' })).toHaveFocus()
    })

    it('leaves focus alone when it is not in the overlay', () => {
      render(
        <MediasModal
          medias={[buildAttachment({ name: 'Ridge' })]}
          initialSelection={0}
          onClosed={vi.fn()}
        />
      )
      openDetails()
      const close = screen.getByRole('button', { name: 'Close media dialog' })
      close.focus()

      fireEvent.keyDown(document, { key: 'Escape' })

      expect(close).toHaveFocus()
    })

    it('moves focus to the close button when the Details button becomes invisible', () => {
      render(
        <MediasModal
          medias={[
            buildAttachment({ id: 'a', name: 'First' }),
            buildAttachment({ id: 'b', name: '' })
          ]}
          initialSelection={0}
          onClosed={vi.fn()}
        />
      )
      const details = screen.getByRole('button', { name: 'Details' })
      details.focus()
      expect(details).toHaveFocus()

      fireEvent.click(screen.getByRole('button', { name: 'Next media' }))

      expect(
        screen.getByRole('button', { name: 'Close media dialog' })
      ).toHaveFocus()
    })

    it('moves focus from the overlay to the close button when the next photo has nothing to show', () => {
      render(
        <MediasModal
          medias={[
            buildAttachment({ id: 'a', name: 'First' }),
            buildAttachment({ id: 'b', name: '' })
          ]}
          initialSelection={0}
          onClosed={vi.fn()}
        />
      )
      openDetails()
      screen.getByRole('region', { name: 'Photo details' }).focus()

      fireEvent.keyDown(window, { key: 'ArrowRight' })

      expect(
        screen.getByRole('button', { name: 'Close media dialog' })
      ).toHaveFocus()
    })
  })

  it('puts the GIF toggle at the top-left of the image, clear of the overlay', async () => {
    const gif = buildAttachment({
      id: 'attachment-gif-pos',
      mediaType: 'image/gif',
      thumbnailUrl: 'https://activities.local/media/preview.jpg'
    })
    await act(async () => {
      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <MediasModal medias={[gif]} initialSelection={0} onClosed={vi.fn()} />
        </PlaybackPreferencesProvider>
      )
    })

    const toggle = screen.getByRole('button', { name: 'Play animation' })
    expect(toggle).toHaveClass('top-2', 'left-2')
    expect(toggle).not.toHaveClass('bottom-2')
  })

  it('keeps the overlay clear of the arrows when navigation is shown', () => {
    render(
      <MediasModal
        medias={[
          buildAttachment({ id: 'a', name: 'First' }),
          buildAttachment({ id: 'b', name: 'Second' })
        ]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )
    const overlay = document.querySelector('[aria-label="Photo details"]')
    expect(overlay).toHaveClass('inset-x-3', 'max-h-[calc(50%-2.5rem)]')
  })

  it('renders custom emoji images in alt text when matching tags are passed', () => {
    const attachment = buildAttachment({
      name: 'Image caption with :blobcat:'
    })

    render(
      <MediasModal
        medias={[attachment]}
        tags={[
          {
            type: 'emoji',
            name: ':blobcat:',
            value: 'https://example.com/blobcat.png'
          }
        ]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )
    openDetails()

    const imgs = screen.getAllByRole('img', { name: ':blobcat:' })
    expect(imgs.length).toBeGreaterThanOrEqual(1)
    expect(imgs[0]).toHaveAttribute('src', 'https://example.com/blobcat.png')
  })

  it('allows autoplay for active slide but disables autoplay for inactive slides and thumbnails', async () => {
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(async () => {})
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})

    const first = buildAttachment({
      id: 'attachment-1',
      mediaType: 'video/mp4',
      playbackType: 'gifv',
      url: 'https://activities.local/media/1.mp4'
    })
    const second = buildAttachment({
      id: 'attachment-2',
      mediaType: 'video/mp4',
      playbackType: 'gifv',
      url: 'https://activities.local/media/2.mp4'
    })

    await act(async () => {
      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={true}>
          <MediasModal
            medias={[first, second]}
            initialSelection={0}
            onClosed={vi.fn()}
          />
        </PlaybackPreferencesProvider>
      )
    })

    // Only the active slide (panelIndex === 1) should have triggered play()
    expect(playSpy).toHaveBeenCalledTimes(1)
  })

  it('has dialog accessibility attributes and labelled navigation buttons', () => {
    const attachment = buildAttachment({ name: 'Pic 1' })
    const second = buildAttachment({ id: 'attachment-2', name: 'Pic 2' })

    render(
      <MediasModal
        medias={[attachment, second]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    const dialog = screen.getByRole('dialog', { name: 'Media viewer' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    expect(
      screen.getByRole('button', { name: 'Close media dialog' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Previous media' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Next media' })
    ).toBeInTheDocument()
  })

  it('closes when Escape key is pressed', () => {
    const onClosed = vi.fn()
    const attachment = buildAttachment()

    render(
      <MediasModal
        medias={[attachment]}
        initialSelection={0}
        onClosed={onClosed}
      />
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClosed).toHaveBeenCalledTimes(1)
  })

  it('supports manual playback toggle for animated GIFs in the lightbox', async () => {
    const gif = buildAttachment({
      id: 'attachment-gif',
      mediaType: 'image/gif',
      url: 'https://activities.local/media/animation.gif',
      thumbnailUrl: 'https://activities.local/media/preview.jpg'
    })

    await act(async () => {
      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <MediasModal medias={[gif]} initialSelection={0} onClosed={vi.fn()} />
        </PlaybackPreferencesProvider>
      )
    })

    // With autoplay disabled, a play button overlay is present
    const playButton = screen.getByRole('button', { name: 'Play animation' })
    expect(playButton).toBeInTheDocument()

    // Clicking it toggles to pause button
    await act(async () => {
      fireEvent.click(playButton)
    })

    expect(
      screen.getByRole('button', { name: 'Pause animation' })
    ).toBeInTheDocument()
  })

  it('respects prefers-reduced-motion in the lightbox even if autoplay is enabled', async () => {
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

      const gif = buildAttachment({
        id: 'attachment-gif-reduced',
        mediaType: 'image/gif',
        url: 'https://activities.local/media/animation.gif',
        thumbnailUrl: 'https://activities.local/media/preview.jpg'
      })

      await act(async () => {
        render(
          <PlaybackPreferencesProvider initialAutoplayGifs={true}>
            <MediasModal
              medias={[gif]}
              initialSelection={0}
              onClosed={vi.fn()}
            />
          </PlaybackPreferencesProvider>
        )
      })

      // Even with autoplayGifs=true, prefers-reduced-motion prevents autoplay,
      // so button should show 'Play animation'
      const playButton = screen.getByRole('button', { name: 'Play animation' })
      expect(playButton).toBeInTheDocument()

      // Clicking it manually starts playback
      await act(async () => {
        fireEvent.click(playButton)
      })

      expect(
        screen.getByRole('button', { name: 'Pause animation' })
      ).toBeInTheDocument()
    } finally {
      window.matchMedia = originalMatchMedia
    }
  })
})
