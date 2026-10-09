/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import {
  getAccountGalleryAlbums,
  getGalleryLifeList,
  getGalleryMap,
  getGallerySubjects
} from '@/lib/client'
import { buildAlbumCard } from '@/lib/components/gallery/__fixtures__/galleryAlbums'
import {
  buildGallerySubject,
  buildLifeListEntry
} from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryMapResponse } from '@/lib/services/gallery/galleryEntities'
import type { Attachment } from '@/lib/types/domain/attachment'

import { ProfileGalleryTab } from './ProfileGalleryTab'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush })
}))

vi.mock('@/lib/client', () => ({
  getAccountGalleryAlbums: vi.fn(),
  getGalleryLifeList: vi.fn(),
  getGalleryMap: vi.fn(),
  getGalleryMedia: vi.fn(),
  getGallerySubjects: vi.fn()
}))

vi.mock('@/lib/components/posts/media', () => ({
  Media: ({ attachment }: { attachment?: Attachment }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={attachment?.url} alt="" />
  )
}))

vi.mock('@/lib/components/gallery/GalleryPagedGrid', () => ({
  GalleryPagedGrid: ({
    subject,
    category
  }: {
    subject?: string
    category?: string
  }) => (
    <div data-testid="paged-grid">
      subject={subject ?? ''};category={category ?? ''}
    </div>
  )
}))

vi.mock('@/lib/components/gallery/GalleryMap', () => ({
  GalleryMap: ({
    points,
    onSelect
  }: {
    points: { mediaId: string }[]
    onSelect?: (mediaId: string) => void
  }) => (
    <div data-testid="map">
      {points.map((point) => (
        <button key={point.mediaId} onClick={() => onSelect?.(point.mediaId)}>
          point {point.mediaId}
        </button>
      ))}
    </div>
  )
}))

const getGallerySubjectsMock = getGallerySubjects as jest.Mock
const getGalleryLifeListMock = getGalleryLifeList as jest.Mock
const getGalleryMapMock = getGalleryMap as jest.Mock
const getAlbumsMock = vi.mocked(getAccountGalleryAlbums)

const subjects = {
  groups: [
    {
      category: 'bird',
      subjects: [
        buildGallerySubject('sci:alcedo atthis', { name: 'Kingfisher' })
      ]
    }
  ],
  unidentifiedCount: 0,
  countryCount: null,
  truncated: false
}

const mapResponse: GalleryMapResponse = {
  points: [
    {
      mediaId: '11',
      statusId: 'status-11',
      latitude: 1,
      longitude: 2,
      precision: 'exact',
      subjectName: 'Kingfisher',
      placeName: 'Khao Yai',
      countryCode: null,
      thumbnailUrl: null,
      takenAt: null
    }
  ],
  countryCount: null,
  truncated: false
}

const renderTab = (
  props: Partial<React.ComponentProps<typeof ProfileGalleryTab>> = {}
) =>
  render(
    <ProfileGalleryTab
      actorId="actor-1"
      handle="@llun@llun.test"
      subviews={['subjects', 'recent', 'map', 'life-list']}
      mapProvider={{ type: 'osm' }}
      {...props}
    />
  )

const openSubview = async (name: string) => {
  const nav = screen.getByRole('navigation', { name: 'Gallery views' })
  fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('menuitem', { name }))
}

describe('ProfileGalleryTab', () => {
  beforeEach(() => {
    getGallerySubjectsMock.mockReset().mockResolvedValue(subjects)
    getGalleryLifeListMock.mockReset()
    getGalleryMapMock.mockReset()
    getAlbumsMock.mockReset()
    mockPush.mockReset()
  })

  it('loads subjects first, with a skeleton meanwhile', async () => {
    renderTab()
    expect(screen.getByText('Loading gallery')).toBeInTheDocument()
    expect(
      await screen.findByRole('region', { name: 'Birds' })
    ).toBeInTheDocument()
    expect(getGallerySubjectsMock).toHaveBeenCalledWith('actor-1')
  })

  it('offers only the subviews it is given', async () => {
    renderTab({ subviews: ['subjects', 'recent'] })
    await screen.findByRole('region', { name: 'Birds' })

    const nav = screen.getByRole('navigation', { name: 'Gallery views' })
    fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Subjects',
      'Recent'
    ])
  })

  it('shows no switcher when there is a single subview', async () => {
    renderTab({ subviews: ['subjects'] })
    await screen.findByRole('region', { name: 'Birds' })
    expect(
      screen.queryByRole('navigation', { name: 'Gallery views' })
    ).not.toBeInTheDocument()
  })

  it('shows an error when subjects fail to load', async () => {
    getGallerySubjectsMock.mockRejectedValue(new Error('Nope'))
    renderTab()
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
  })

  it('filters in place to one subject, with a chip that goes back', async () => {
    renderTab()
    fireEvent.click(await screen.findByRole('button', { name: /Kingfisher/ }))

    expect(screen.getByTestId('paged-grid')).toHaveTextContent(
      'subject=sci:alcedo atthis'
    )
    expect(screen.getByText('Kingfisher')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: 'Back to all subjects' })
    )
    expect(
      await screen.findByRole('region', { name: 'Birds' })
    ).toBeInTheDocument()
  })

  it('See all on a category opens Recent filtered by it, and the chip clears it', async () => {
    renderTab()
    await screen.findByRole('region', { name: 'Birds' })
    fireEvent.click(screen.getByRole('button', { name: 'See all' }))

    expect(screen.getByTestId('paged-grid')).toHaveTextContent('category=bird')
    fireEvent.click(
      screen.getByRole('button', { name: 'Show all photos and videos' })
    )
    expect(screen.getByTestId('paged-grid')).toHaveTextContent(
      'subject=;category='
    )
  })

  it('renders the life list and filters from a species name', async () => {
    getGalleryLifeListMock.mockResolvedValue({
      total: 1,
      byCategory: { bird: 1 },
      entries: [
        buildLifeListEntry('sci:alcedo atthis', { name: 'Common Kingfisher' })
      ],
      truncated: false
    })
    renderTab()
    await screen.findByRole('region', { name: 'Birds' })
    await openSubview('Life list')

    fireEvent.click(
      await screen.findByRole('button', { name: 'Common Kingfisher' })
    )
    expect(screen.getByTestId('paged-grid')).toHaveTextContent(
      'subject=sci:alcedo atthis'
    )
  })

  it('says so when the life list is not public (404 -> null)', async () => {
    getGalleryLifeListMock.mockResolvedValue(null)
    renderTab()
    await screen.findByRole('region', { name: 'Birds' })
    await openSubview('Life list')
    expect(await screen.findByText('No life list to show')).toBeInTheDocument()
  })

  it("renders the map and opens the selected point's post", async () => {
    getGalleryMapMock.mockResolvedValue(mapResponse)
    renderTab()
    await screen.findByRole('region', { name: 'Birds' })
    await openSubview('Map')

    fireEvent.click(await screen.findByRole('button', { name: 'point 11' }))
    expect(mockPush).toHaveBeenCalledWith('/@llun@llun.test/status-11')
  })

  it('hands an empty point list to the map when it is not public', async () => {
    getGalleryMapMock.mockResolvedValue(null)
    renderTab()
    await screen.findByRole('region', { name: 'Birds' })
    await openSubview('Map')
    const map = await screen.findByTestId('map')
    expect(map).toBeEmptyDOMElement()
  })

  it('gives the owner a button to the full gallery', async () => {
    const { unmount } = renderTab({ isCurrentUser: true })
    await screen.findByRole('region', { name: 'Birds' })
    expect(screen.getByRole('link', { name: 'Gallery' })).toHaveAttribute(
      'href',
      '/gallery'
    )
    unmount()

    renderTab({ isCurrentUser: false })
    await screen.findByRole('region', { name: 'Birds' })
    expect(screen.queryByRole('link', { name: 'Gallery' })).toBeNull()
  })
  describe('Albums', () => {
    const withAlbums = ['subjects', 'recent', 'albums', 'map'] as const

    it('offers the Albums chip between Recent and Map when it is given', async () => {
      renderTab({ subviews: [...withAlbums] })
      await screen.findByRole('region', { name: 'Birds' })

      const nav = screen.getByRole('navigation', { name: 'Gallery views' })
      fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
      const items = await screen.findAllByRole('menuitem')
      expect(items.map((item) => item.textContent)).toEqual([
        'Subjects',
        'Recent',
        'Albums',
        'Map'
      ])
    })

    it('does not offer it when the page did not, which is when the viewer has no album to open', async () => {
      renderTab({ subviews: ['subjects', 'recent', 'map'] })
      await screen.findByRole('region', { name: 'Birds' })

      const nav = screen.getByRole('navigation', { name: 'Gallery views' })
      fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
      expect(screen.queryByRole('menuitem', { name: 'Albums' })).toBeNull()
    })

    it('does not offer it without a handle to link an album to', async () => {
      renderTab({ subviews: [...withAlbums], handle: undefined })
      await screen.findByRole('region', { name: 'Birds' })

      const nav = screen.getByRole('navigation', { name: 'Gallery views' })
      fireEvent.keyDown(nav.querySelector('button')!, { key: 'ArrowDown' })
      expect(screen.queryByRole('menuitem', { name: 'Albums' })).toBeNull()
    })

    it('lists the account albums as links to their public pages', async () => {
      getAlbumsMock.mockResolvedValue({
        albums: [
          buildAlbumCard('a1', { title: 'Kruger' }),
          buildAlbumCard('b/2', { title: 'Lakes' })
        ],
        photoCount: 6
      })
      renderTab({ subviews: [...withAlbums] })
      await screen.findByRole('region', { name: 'Birds' })

      await openSubview('Albums')

      expect(
        await screen.findByRole('link', { name: /Kruger/ })
      ).toHaveAttribute('href', '/@llun@llun.test/albums/a1')
      expect(screen.getByRole('link', { name: /Lakes/ })).toHaveAttribute(
        'href',
        '/@llun@llun.test/albums/b%2F2'
      )
      expect(getAlbumsMock).toHaveBeenCalledWith('actor-1')
    })

    it("lists the owner's albums, private ones badged, as links to their own album page", async () => {
      getAlbumsMock.mockResolvedValue({
        albums: [
          buildAlbumCard('a1', { title: 'Kruger' }),
          buildAlbumCard('b/2', { title: 'Secret', visibility: 'private' })
        ],
        photoCount: 6
      })
      renderTab({ subviews: [...withAlbums], isCurrentUser: true })
      await screen.findByRole('region', { name: 'Birds' })

      await openSubview('Albums')

      // A private album has no public page, so neither card goes there.
      expect(
        await screen.findByRole('link', { name: /Kruger/ })
      ).toHaveAttribute('href', '/gallery/albums/a1')
      const secret = screen.getByRole('link', { name: /Secret/ })
      expect(secret).toHaveAttribute('href', '/gallery/albums/b%2F2')
      expect(within(secret).getByText('Private')).toBeInTheDocument()
      expect(
        within(screen.getByRole('link', { name: /Kruger/ })).queryByText(
          'Private'
        )
      ).toBeNull()
    })

    it('says so when there is nothing to show', async () => {
      getAlbumsMock.mockResolvedValue({ albums: [], photoCount: 0 })
      renderTab({ subviews: [...withAlbums] })
      await screen.findByRole('region', { name: 'Birds' })

      await openSubview('Albums')

      expect(await screen.findByText('No albums to show')).toBeInTheDocument()
    })

    it('shows an error when the albums fail to load', async () => {
      getAlbumsMock.mockRejectedValue(new Error('Rate limited'))
      renderTab({ subviews: [...withAlbums] })
      await screen.findByRole('region', { name: 'Birds' })

      await openSubview('Albums')

      expect(await screen.findByRole('alert')).toHaveTextContent('Rate limited')
    })
  })
})
