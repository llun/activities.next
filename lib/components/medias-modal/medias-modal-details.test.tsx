/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { getMediaPublicDetails } from '@/lib/client'
import { PlaybackPreferencesProvider } from '@/lib/components/preferences/PlaybackPreferencesContext'
import type { MediaPublicDetails } from '@/lib/services/gallery/galleryEntities'
import { Attachment } from '@/lib/types/domain/attachment'

import { MediasModal } from './medias-modal'

vi.mock('@/lib/client', () => ({
  getMediaPublicDetails: vi.fn()
}))

const mockGetMediaPublicDetails = vi.mocked(getMediaPublicDetails)

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

const takenAt = '2026-04-20T08:30:00.000Z'

const kingfisherDetails: MediaPublicDetails = {
  subject: {
    name: 'Common Kingfisher',
    scientificName: 'Alcedo atthis',
    category: 'bird',
    taxonKey: null,
    taxonPath: null
  },
  takenAt,
  camera: { name: 'Nikon Z8' },
  lens: { name: 'Nikkor 600mm' },
  exposure: {
    focalLengthMm: 600,
    aperture: 6.3,
    exposureTime: '1/1000',
    iso: 800
  },
  place: {
    name: 'Lake Kinneret',
    precision: 'area',
    latitude: 32.8,
    countryCode: null
  }
}

const openDetails = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Details' }))

// The button only appears once the photo has something to show, which for a
// photo without alt text is when its details arrive.
const openDetailsWhenReady = async () =>
  fireEvent.click(await screen.findByRole('button', { name: 'Details' }))

const renderModal = (medias: Attachment[], initialSelection = 0) =>
  render(
    <PlaybackPreferencesProvider initialAutoplayGifs={false}>
      <MediasModal
        medias={medias}
        initialSelection={initialSelection}
        onClosed={vi.fn()}
      />
    </PlaybackPreferencesProvider>
  )

describe('MediasModal media details', () => {
  beforeEach(() => {
    mockGetMediaPublicDetails.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the image cap unchanged when details load, and shows them only in the overlay', async () => {
    mockGetMediaPublicDetails.mockResolvedValue(kingfisherDetails)

    renderModal([buildAttachment({ mediaId: 'media-1', name: 'A bird' })])

    const image = document.querySelectorAll('img')[1]
    const before = image.className
    expect(image).toHaveClass('max-h-[calc(100dvh-6rem)]')
    await waitFor(() => expect(mockGetMediaPublicDetails).toHaveBeenCalled())
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText('Common Kingfisher')).not.toBeVisible()
    expect(image.className).toBe(before)

    openDetails()
    expect(screen.getByText('Common Kingfisher')).toBeVisible()
    const subject = screen.getByText('Common Kingfisher')
    expect(document.querySelectorAll('img')[1].className).toBe(before)
    const region = screen.getByRole('region', { name: 'Photo details' })
    expect(region).toContainElement(subject)
    expect(region).toHaveTextContent('A bird')
  })

  it('makes the scrollable details region keyboard reachable', async () => {
    mockGetMediaPublicDetails.mockResolvedValue(kingfisherDetails)

    renderModal([buildAttachment({ mediaId: 'media-1', name: 'A bird' })])

    await waitFor(() => expect(mockGetMediaPublicDetails).toHaveBeenCalled())
    openDetails()
    const region = await screen.findByRole('region', { name: 'Photo details' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(region).toHaveTextContent('Common Kingfisher')
  })

  it('opens the overlay with the alt text only when there are no details', async () => {
    mockGetMediaPublicDetails.mockResolvedValue(null as never)

    renderModal([buildAttachment({ mediaId: 'media-1', name: 'A bird' })])

    await waitFor(() => expect(mockGetMediaPublicDetails).toHaveBeenCalled())
    openDetails()
    // The alt text is still there, so the overlay opens; it is the only content.
    const region = await screen.findByRole('region', { name: 'Photo details' })
    expect(region).toHaveTextContent('A bird')
    expect(region).not.toHaveTextContent('Common Kingfisher')
  })

  it.each([
    ['media without details', null],
    [
      'a details payload that is all null',
      {
        subject: null,
        takenAt: null,
        camera: null,
        lens: null,
        exposure: null,
        place: null
      } as MediaPublicDetails
    ]
  ])(
    'keeps the same image cap and hides the Details button for %s',
    async (_label, payload) => {
      mockGetMediaPublicDetails.mockResolvedValue(payload as never)

      renderModal([buildAttachment({ mediaId: 'media-1' })])

      await waitFor(() => expect(mockGetMediaPublicDetails).toHaveBeenCalled())
      // Let the resolved payload reach state before asserting on the layout.
      await act(async () => {
        await Promise.resolve()
      })
      const image = document.querySelector('img')
      expect(image).toHaveClass('max-h-[calc(100dvh-6rem)]')
      // Nothing to show: no region and the Details button keeps its space.
      expect(screen.getByText('Details').closest('button')).toHaveClass(
        'invisible'
      )
      expect(
        screen.queryByRole('region', { name: 'Photo details' })
      ).not.toBeInTheDocument()
    }
  )

  it('renders the public details of the shown photo', async () => {
    mockGetMediaPublicDetails.mockResolvedValue(kingfisherDetails)

    renderModal([buildAttachment({ mediaId: 'media-1' })])

    await openDetailsWhenReady()
    expect(await screen.findByText('Common Kingfisher')).toBeInTheDocument()
    expect(screen.getByText('Alcedo atthis')).toBeInTheDocument()
    expect(screen.getByText('bird')).toBeInTheDocument()
    expect(screen.getByText('Nikon Z8 · Nikkor 600mm')).toBeInTheDocument()
    expect(
      screen.getByText('600 mm · f/6.3 · 1/1000 s · ISO 800')
    ).toBeInTheDocument()
    expect(screen.getByText('Lake Kinneret · within 5 km')).toBeInTheDocument()
    const takenLabel = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium'
    }).format(new Date(takenAt))
    expect(screen.getByText(takenLabel)).toBeInTheDocument()
    expect(mockGetMediaPublicDetails).toHaveBeenCalledWith('media-1')
  })

  it('renders nothing for details when the call returns null', async () => {
    mockGetMediaPublicDetails.mockResolvedValue(null)

    renderModal([buildAttachment({ mediaId: 'media-1' })])

    await waitFor(() =>
      expect(mockGetMediaPublicDetails).toHaveBeenCalledWith('media-1')
    )
    expect(screen.queryByText('Common Kingfisher')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Nikon Z8 · Nikkor 600mm')
    ).not.toBeInTheDocument()
  })

  it('does not request details for an attachment without a media id', async () => {
    renderModal([buildAttachment({ mediaId: null })])

    expect(mockGetMediaPublicDetails).not.toHaveBeenCalled()
  })

  it('does not refetch details when navigating back to a photo', async () => {
    mockGetMediaPublicDetails.mockImplementation(async (mediaId) =>
      mediaId === 'media-1' ? kingfisherDetails : null
    )

    renderModal([
      buildAttachment({ id: 'attachment-1', mediaId: 'media-1' }),
      buildAttachment({ id: 'attachment-2', mediaId: 'media-2' })
    ])

    await openDetailsWhenReady()
    expect(await screen.findByText('Common Kingfisher')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next media' }))
    await waitFor(() =>
      expect(mockGetMediaPublicDetails).toHaveBeenCalledWith('media-2')
    )
    expect(screen.queryByText('Common Kingfisher')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous media' }))
    expect(await screen.findByText('Common Kingfisher')).toBeInTheDocument()

    const media1Calls = mockGetMediaPublicDetails.mock.calls.filter(
      ([mediaId]) => mediaId === 'media-1'
    )
    expect(media1Calls).toHaveLength(1)
  })
  describe('viewing sessions', () => {
    const greyHeronDetails: MediaPublicDetails = {
      ...kingfisherDetails,
      subject: {
        name: 'Grey Heron',
        scientificName: 'Ardea cinerea',
        category: 'bird',
        taxonKey: null,
        taxonPath: null
      }
    }

    const modalFor = (medias: Attachment[] | null) => (
      <PlaybackPreferencesProvider initialAutoplayGifs={false}>
        <MediasModal medias={medias} initialSelection={0} onClosed={vi.fn()} />
      </PlaybackPreferencesProvider>
    )

    it('fetches details again when the modal is reopened', async () => {
      mockGetMediaPublicDetails
        .mockResolvedValueOnce(kingfisherDetails)
        .mockResolvedValueOnce(greyHeronDetails)
      const medias = [buildAttachment({ mediaId: 'media-1' })]

      const { rerender } = render(modalFor(medias))
      await openDetailsWhenReady()
      expect(await screen.findByText('Common Kingfisher')).toBeInTheDocument()

      rerender(modalFor(null))
      rerender(modalFor([buildAttachment({ mediaId: 'media-1' })]))

      await openDetailsWhenReady()
      expect(await screen.findByText('Grey Heron')).toBeInTheDocument()
      expect(screen.queryByText('Common Kingfisher')).not.toBeInTheDocument()
      expect(mockGetMediaPublicDetails).toHaveBeenCalledTimes(2)
    })

    it('drops a response that arrives after the modal was reopened', async () => {
      let resolveFirst: (value: MediaPublicDetails | null) => void = () => {}
      mockGetMediaPublicDetails
        .mockReturnValueOnce(
          new Promise<MediaPublicDetails | null>((resolve) => {
            resolveFirst = resolve
          })
        )
        .mockResolvedValueOnce(greyHeronDetails)
      const medias = [buildAttachment({ mediaId: 'media-1' })]

      const { rerender } = render(modalFor(medias))
      rerender(modalFor(null))
      rerender(modalFor([buildAttachment({ mediaId: 'media-1' })]))
      await openDetailsWhenReady()
      expect(await screen.findByText('Grey Heron')).toBeInTheDocument()

      resolveFirst(kingfisherDetails)
      await waitFor(() =>
        expect(mockGetMediaPublicDetails).toHaveBeenCalledTimes(2)
      )
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(screen.getByText('Grey Heron')).toBeInTheDocument()
      expect(screen.queryByText('Common Kingfisher')).not.toBeInTheDocument()
    })
  })
})
