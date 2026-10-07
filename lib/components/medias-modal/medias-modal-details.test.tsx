/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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
    category: 'bird'
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
  place: { name: 'Lake Kinneret', precision: 'area', latitude: 32.8 }
}

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

  it('renders the public details of the shown photo', async () => {
    mockGetMediaPublicDetails.mockResolvedValue(kingfisherDetails)

    renderModal([buildAttachment({ mediaId: 'media-1' })])

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
})
