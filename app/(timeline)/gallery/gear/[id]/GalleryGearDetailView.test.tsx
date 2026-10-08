/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import {
  deleteGalleryGear,
  getGalleryMedia,
  setGalleryGearRetired
} from '@/lib/client'
import type {
  GalleryGearWithUsageEntity,
  GalleryItemEntity
} from '@/lib/services/gallery/galleryEntities'
import { createDeferred } from '@/lib/testing/deferred'
import type { Attachment } from '@/lib/types/domain/attachment'

import { GalleryGearDetailView } from './GalleryGearDetailView'

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh })
}))

vi.mock('@/lib/client', () => ({
  deleteGalleryGear: vi.fn(),
  getGalleryMedia: vi.fn(),
  setGalleryGearRetired: vi.fn(),
  updateGalleryGear: vi.fn(),
  createGalleryGear: vi.fn()
}))

// The lightbox has its own tests; here it marks which attachments it was given.
vi.mock('@/lib/components/medias-modal/medias-modal', () => ({
  MediasModal: ({
    medias,
    initialSelection
  }: {
    medias: Attachment[] | null
    initialSelection: number
  }): ReactNode =>
    medias ? (
      <div data-testid="lightbox" data-selected={initialSelection}>
        {medias.length} in lightbox
      </div>
    ) : null
}))

const mockDelete = vi.mocked(deleteGalleryGear)
const mockRetire = vi.mocked(setGalleryGearRetired)
const mockMediaPage = vi.mocked(getGalleryMedia)

const createGear = (
  overrides: Partial<GalleryGearWithUsageEntity> = {}
): GalleryGearWithUsageEntity => ({
  id: 'cam-1',
  kind: 'camera',
  name: 'Sony α1',
  brand: 'Sony',
  model: 'ILCE-1',
  productUrl: 'https://www.sony.com/alpha',
  retiredAt: null,
  createdAt: Date.UTC(2024, 2, 12),
  photoCount: 846,
  videoCount: 34,
  countryCount: 5,
  firstUsedAt: Date.UTC(2024, 2, 14),
  lastUsedAt: Date.UTC(2026, 9, 7),
  ...overrides
})

const createItem = (id: string): GalleryItemEntity => ({
  mediaId: id,
  statusId: `status-${id}`,
  attachment: {
    id: `attachment-${id}`,
    mediaType: 'image/jpeg',
    url: `https://media.test/${id}.jpg`,
    thumbnailUrl: `https://media.test/${id}-thumb.jpg`,
    name: `Photo ${id}`,
    width: 100,
    height: 100
  } as unknown as Attachment,
  subject: null,
  takenAt: null,
  camera: null,
  lens: null,
  exposure: null,
  place: null
})

const lensGear = {
  id: 'lens-1',
  kind: 'lens' as const,
  name: 'FE 600mm F4 GM',
  brand: null,
  model: null,
  productUrl: null,
  retiredAt: null,
  createdAt: 1
}

const renderView = (
  props: Partial<Parameters<typeof GalleryGearDetailView>[0]> = {}
) =>
  render(
    <GalleryGearDetailView
      ownerId="https://llun.test/users/me"
      gear={createGear()}
      mostUsedWith={[]}
      initialPage={{
        items: [createItem('m1'), createItem('m2')],
        nextMaxId: null
      }}
      {...props}
    />
  )

describe('GalleryGearDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('draws the header: back link, name, meta line and product link', () => {
    renderView()

    const back = screen.getByRole('link', { name: 'Back to gear' })
    expect(back).toHaveAttribute('href', '/gallery/gear')
    expect(back).toHaveTextContent(/^Back$/)
    expect(screen.getByRole('heading', { name: 'Sony α1' })).toBeVisible()
    expect(
      screen.getByText(
        'Sony ILCE-1 · camera · added 12 Mar 2024 · first photo 14 Mar 2024 · last photo 7 Oct 2026'
      )
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Product page: sony.com' })
    ).toHaveAttribute('href', 'https://www.sony.com/alpha')
  })

  it('shows the stat strip', () => {
    renderView()

    // 846 items in the gallery, 34 of them videos.
    expect(screen.getByText('Photos')).toBeVisible()
    expect(screen.getByText('812')).toBeVisible()
    expect(screen.getByText('Videos')).toBeVisible()
    expect(screen.getByText('34')).toBeVisible()
    expect(screen.getByText('Places')).toBeVisible()
    expect(screen.getByText('5 countries')).toBeVisible()
  })

  it('shows a dash for Places when no country is known', () => {
    renderView({ gear: createGear({ countryCount: null }) })

    const places = screen.getByText('Places').closest('dl')
    expect(places).toHaveTextContent('Unavailable')
    expect(screen.queryByText(/countries/)).not.toBeInTheDocument()
  })

  it('says 1 country in the singular', () => {
    renderView({ gear: createGear({ countryCount: 1 }) })

    expect(screen.getByText('1 country')).toBeVisible()
  })

  it('omits the brand and model from the meta line when they are the name', () => {
    renderView({ gear: createGear({ name: 'Sony ILCE-1' }) })

    expect(screen.getByText(/^camera · added/)).toBeVisible()
  })

  it('says so when the gear has never been used', () => {
    renderView({
      gear: createGear({
        photoCount: 0,
        firstUsedAt: null,
        lastUsedAt: null,
        productUrl: null
      }),
      initialPage: { items: [], nextMaxId: null }
    })

    expect(screen.getByText('0 items')).toBeVisible()
    expect(
      screen.getByText(
        'Nothing in your gallery was taken with this camera yet.'
      )
    ).toBeVisible()
    expect(
      screen.getByText('Sony ILCE-1 · camera · added 12 Mar 2024')
    ).toBeVisible()
  })

  it('titles the grid for a lens', () => {
    renderView({ gear: createGear({ kind: 'lens', photoCount: 1 }) })

    expect(
      screen.getByRole('heading', { name: 'Taken with this lens' })
    ).toBeVisible()
    expect(screen.getByText('1 item')).toBeVisible()
  })

  it('opens the lightbox at the clicked photo', () => {
    renderView()

    expect(screen.queryByTestId('lightbox')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Open media: Photo m2' })
    )

    expect(screen.getByTestId('lightbox')).toHaveAttribute('data-selected', '1')
    expect(screen.getByTestId('lightbox')).toHaveTextContent('2 in lightbox')
  })

  it('loads the next page with max_id and drops the button on the last page', async () => {
    mockMediaPage.mockResolvedValueOnce({
      items: [createItem('m3')],
      nextMaxId: null
    })
    renderView({
      initialPage: { items: [createItem('m1')], nextMaxId: '5' }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(
      await screen.findByRole('button', { name: 'Open media: Photo m3' })
    ).toBeVisible()
    expect(mockMediaPage).toHaveBeenCalledWith('https://llun.test/users/me', {
      maxId: '5',
      limit: 30,
      gearId: 'cam-1',
      subject: undefined,
      category: undefined
    })
    expect(
      screen.queryByRole('button', { name: 'Load more' })
    ).not.toBeInTheDocument()
  })

  it('shows a load-more failure and keeps the button', async () => {
    mockMediaPage.mockRejectedValueOnce(new Error('Failed to load photos.'))
    renderView({ initialPage: { items: [createItem('m1')], nextMaxId: '5' } })

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to load photos.'
    )
    expect(screen.getByRole('button', { name: 'Load more' })).toBeVisible()
  })

  it('lists the gear it is most used with, as links', () => {
    renderView({ mostUsedWith: [{ gear: lensGear, count: 402 }] })

    expect(
      screen.getByRole('heading', { name: 'Most used with' })
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'FE 600mm F4 GM · 402' })
    ).toHaveAttribute('href', '/gallery/gear/lens-1')
  })

  it('leaves out “Most used with” when there is nothing to show', () => {
    renderView()

    expect(
      screen.queryByRole('heading', { name: 'Most used with' })
    ).not.toBeInTheDocument()
  })

  describe('retire', () => {
    it('retires, disabled while in flight, then refreshes the page', async () => {
      const deferred = createDeferred<never>()
      mockRetire.mockReturnValueOnce(deferred.promise)
      renderView()

      fireEvent.click(screen.getByRole('button', { name: 'Retire' }))

      expect(mockRetire).toHaveBeenCalledWith('cam-1', true)
      expect(screen.getByRole('button', { name: 'Retire' })).toBeDisabled()

      deferred.resolve({} as never)

      await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce())
      expect(screen.getByRole('button', { name: 'Retire' })).toBeEnabled()
    })

    it('offers Unretire and a retired pill for retired gear', async () => {
      mockRetire.mockResolvedValue({} as never)
      renderView({ gear: createGear({ retiredAt: Date.UTC(2025, 0, 1) }) })

      expect(screen.getByText('retired')).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: 'Unretire' }))

      expect(mockRetire).toHaveBeenCalledWith('cam-1', false)
      await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    })

    it('shows the failure and does not refresh', async () => {
      mockRetire.mockRejectedValueOnce(new Error('Failed to retire gear.'))
      renderView()

      fireEvent.click(screen.getByRole('button', { name: 'Retire' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to retire gear.'
      )
      expect(mockRefresh).not.toHaveBeenCalled()
    })
  })

  describe('delete', () => {
    it('confirms first, then deletes and returns to the list', async () => {
      mockDelete.mockResolvedValue(undefined)
      renderView()

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      expect(
        screen.getByRole('dialog', { name: 'Delete Sony α1?' })
      ).toBeVisible()
      expect(mockDelete).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Delete gear' }))

      await waitFor(() =>
        expect(mockPush).toHaveBeenCalledWith('/gallery/gear')
      )
      expect(mockDelete).toHaveBeenCalledWith('cam-1')
    })

    it('does nothing when cancelled', () => {
      renderView()

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(mockDelete).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('keeps the dialog open and shows the error when the delete fails', async () => {
      mockDelete.mockRejectedValueOnce(new Error('Failed to delete gear.'))
      renderView()

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
      fireEvent.click(screen.getByRole('button', { name: 'Delete gear' }))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Failed to delete gear.'
      )
      expect(mockPush).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Delete gear' })).toBeEnabled()
    })
  })

  it('opens the edit dialog and refreshes after a save', async () => {
    const { updateGalleryGear } = await import('@/lib/client')
    vi.mocked(updateGalleryGear).mockResolvedValue(createGear())
    renderView()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('dialog', { name: 'Edit camera' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce())
  })
})
