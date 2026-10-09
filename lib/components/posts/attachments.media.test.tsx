/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { PlaybackPreferencesProvider } from '@/lib/components/preferences/PlaybackPreferencesContext'

import { Attachments } from './attachments'
import {
  buildAttachment,
  buildNoteStatus,
  resetAttachmentTestState
} from './attachments.testUtils'
import { ContentWarning } from './content-warning'

beforeEach(() => {
  resetAttachmentTestState()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Attachments', () => {
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

      // strip item (sized from the aspect ratio) > tile > <video>
      const video = container.querySelector('video')
      expect(video).toBeInTheDocument()
      expect(video?.parentElement?.parentElement?.style.width).toBe('576px')
      expect(video?.parentElement).toHaveClass('h-[240px]', 'w-full')
    })

    it('plays a video inline with the player controls instead of opening the lightbox', () => {
      const onMediaSelected = vi.fn()
      const { container } = render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({ mediaType: 'video/mp4', width: 800, height: 600 })
          ])}
          onMediaSelected={onMediaSelected}
        />
      )

      const video = container.querySelector('video')
      expect(video).toHaveAttribute('controls')
      // The controls are interactive content, so nothing may wrap the video in
      // a button, and pressing the picture is the player's (play / pause).
      expect(video?.closest('button')).toBeNull()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()

      const click = new MouseEvent('click', { bubbles: true, cancelable: true })
      video?.dispatchEvent(click)
      expect(click.defaultPrevented).toBe(false)
      expect(onMediaSelected).not.toHaveBeenCalled()
    })

    // `Media` leaves a click on a controlled video alone, so the card's own
    // `stopPropagation` is the only thing keeping a play / pause press from
    // reaching whatever surface embeds the post (a timeline row that opens the
    // status, say).
    it.each([1, 2])(
      'keeps a press on the player of %i video(s) from reaching the surface embedding the post',
      (count) => {
        const surfaceClick = vi.fn()
        const { container } = render(
          <div onClick={surfaceClick}>
            <Attachments
              status={buildNoteStatus(
                Array.from({ length: count }, () =>
                  buildAttachment({
                    mediaType: 'video/mp4',
                    width: 800,
                    height: 600
                  })
                )
              )}
              onMediaSelected={vi.fn()}
            />
          </div>
        )

        const videos = container.querySelectorAll('video')
        expect(videos).toHaveLength(count)
        videos.forEach((video) => fireEvent.click(video))
        expect(surfaceClick).not.toHaveBeenCalled()
      }
    )

    it('plays every video of a strip inline and keeps the pictures opening the lightbox', () => {
      const onMediaSelected = vi.fn()
      const attachments = [
        buildAttachment({ mediaType: 'video/mp4', width: 800, height: 600 }),
        buildAttachment({ width: 800, height: 600 }),
        buildAttachment({ mediaType: 'video/mp4', width: 800, height: 600 })
      ]
      const { container } = render(
        <Attachments
          status={buildNoteStatus(attachments)}
          onMediaSelected={onMediaSelected}
        />
      )

      const videos = Array.from(container.querySelectorAll('video'))
      expect(videos).toHaveLength(2)
      videos.forEach((video) => expect(video).toHaveAttribute('controls'))

      // Only the picture is a button, and it still opens the lightbox on its
      // own place in the list the lightbox is handed (videos included).
      const [picture] = screen.getAllByRole('button')
      fireEvent.click(picture)
      expect(onMediaSelected).toHaveBeenCalledWith(attachments, 1)
    })

    it('keeps a looping GIFV an animation, with no player controls', () => {
      const { container } = render(
        <Attachments
          status={buildNoteStatus([
            buildAttachment({
              mediaType: 'video/mp4',
              playbackType: 'gifv',
              width: 800,
              height: 600
            })
          ])}
          onMediaSelected={vi.fn()}
        />
      )

      expect(container.querySelector('video')).not.toHaveAttribute('controls')
      // The animation chip, not a player: its own play / pause toggle.
      expect(
        screen.getByRole('button', { name: /(Play|Pause) animation/ })
      ).toBeInTheDocument()
    })

    it('keeps a video behind its content warning until the warning is expanded', () => {
      const { container } = render(
        <ContentWarning summary="Spoilers">
          <Attachments
            status={buildNoteStatus([
              buildAttachment({
                mediaType: 'video/mp4',
                width: 800,
                height: 600
              })
            ])}
            onMediaSelected={vi.fn()}
          />
        </ContentWarning>
      )

      // The gate mounts nothing while collapsed: no <video>, so no request.
      expect(container.querySelector('video')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Show content' }))
      expect(container.querySelector('video')).toHaveAttribute('controls')
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

  describe('animation attachments (GIFV and GIF)', () => {
    beforeEach(() => {
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    })

    it('renders a lone GIFV with sibling zoom and play/pause buttons', () => {
      const gifv = buildAttachment({
        mediaType: 'video/mp4',
        playbackType: 'gifv',
        width: 600,
        height: 400
      })
      const onMediaSelected = vi.fn()

      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <Attachments
            status={buildNoteStatus([gifv])}
            onMediaSelected={onMediaSelected}
          />
        </PlaybackPreferencesProvider>
      )

      const zoomButton = screen.getByRole('button', { name: 'Open media 1' })
      const playButton = screen.getByRole('button', { name: 'Play animation' })

      expect(zoomButton).toBeInTheDocument()
      expect(playButton).toBeInTheDocument()
      expect(zoomButton.contains(playButton)).toBe(false)
      expect(playButton.contains(zoomButton)).toBe(false)
    })

    it('opens lightbox when zoom button is clicked', () => {
      const gifv = buildAttachment({
        mediaType: 'video/mp4',
        playbackType: 'gifv',
        width: 600,
        height: 400
      })
      const onMediaSelected = vi.fn()

      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <Attachments
            status={buildNoteStatus([gifv])}
            onMediaSelected={onMediaSelected}
          />
        </PlaybackPreferencesProvider>
      )

      fireEvent.click(screen.getByRole('button', { name: 'Open media 1' }))
      expect(onMediaSelected).toHaveBeenCalledWith([gifv], 0)
    })

    it('toggles playback and does not open lightbox when play/pause button is clicked', async () => {
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
        async () => {}
      )
      const gifv = buildAttachment({
        mediaType: 'video/mp4',
        playbackType: 'gifv',
        width: 600,
        height: 400
      })
      const onMediaSelected = vi.fn()

      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <Attachments
            status={buildNoteStatus([gifv])}
            onMediaSelected={onMediaSelected}
          />
        </PlaybackPreferencesProvider>
      )

      const playButton = screen.getByRole('button', { name: 'Play animation' })
      await act(async () => {
        fireEvent.click(playButton)
      })

      expect(onMediaSelected).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', { name: 'Pause animation' })
      ).toBeInTheDocument()

      const pauseButton = screen.getByRole('button', {
        name: 'Pause animation'
      })
      await act(async () => {
        fireEvent.click(pauseButton)
      })

      expect(onMediaSelected).not.toHaveBeenCalled()
      expect(
        screen.getByRole('button', { name: 'Play animation' })
      ).toBeInTheDocument()
    })

    it('renders animated image/gif with sibling controls', () => {
      const gif = buildAttachment({
        mediaType: 'image/gif',
        url: 'https://activities.local/media/cat.gif',
        thumbnailUrl: 'https://activities.local/media/cat-preview.jpg',
        width: 400,
        height: 300
      })

      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <Attachments
            status={buildNoteStatus([gif])}
            onMediaSelected={vi.fn()}
          />
        </PlaybackPreferencesProvider>
      )

      expect(
        screen.getByRole('button', { name: 'Open media 1' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Play animation' })
      ).toBeInTheDocument()
    })

    it('renders GIFV in a multi-item strip with sibling controls', () => {
      const gifv = buildAttachment({
        mediaType: 'video/mp4',
        playbackType: 'gifv',
        width: 600,
        height: 400
      })
      const regularImage = buildAttachment({ width: 800, height: 600 })

      render(
        <PlaybackPreferencesProvider initialAutoplayGifs={false}>
          <Attachments
            status={buildNoteStatus([gifv, regularImage])}
            onMediaSelected={vi.fn()}
          />
        </PlaybackPreferencesProvider>
      )

      expect(
        screen.getByRole('button', { name: 'Open media 1' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Play animation' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Open media 2' })
      ).toBeInTheDocument()
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
})
