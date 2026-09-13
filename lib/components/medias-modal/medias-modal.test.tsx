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
  it('renders alt text underneath image when description exists', () => {
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

    const alts = screen.getAllByText('A mountaineer walking along a ridge')
    expect(alts[0]).toBeInTheDocument()
    expect(alts[0]).toHaveClass('text-white/85', 'text-sm')
  })

  it('does not render alt text paragraph when description is empty or whitespace', () => {
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

    expect(container.querySelector('p')).not.toBeInTheDocument()
  })

  it('shows the corresponding alt text when navigating between media items', () => {
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

    expect(screen.getByText('First photo description')).toBeInTheDocument()

    const secondThumbnail = screen.getByRole('button', {
      name: /Second photo description/i
    })
    fireEvent.click(secondThumbnail)

    expect(screen.getByText('Second photo description')).toBeInTheDocument()
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

  it('stops touch event propagation on alt text paragraph', () => {
    const attachment = buildAttachment({
      name: 'Touch description'
    })

    render(
      <MediasModal
        medias={[attachment]}
        initialSelection={0}
        onClosed={vi.fn()}
      />
    )

    const altElements = screen.getAllByText('Touch description')
    const touchStartEvent = new Event('touchstart', { bubbles: true })
    const stopPropagationSpy = vi.spyOn(touchStartEvent, 'stopPropagation')

    altElements[1].dispatchEvent(touchStartEvent)
    expect(stopPropagationSpy).toHaveBeenCalled()
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
})
