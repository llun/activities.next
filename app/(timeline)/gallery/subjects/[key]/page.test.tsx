/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import { getDatabase } from '@/lib/database'
import {
  getGalleryMediaPage,
  getGallerySubjects
} from '@/lib/services/gallery/galleryQueries'

import Page from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  })
}))

vi.mock('@/lib/database', () => ({ getDatabase: vi.fn() }))
vi.mock('@/lib/services/auth/getSession', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({})
}))
vi.mock('@/lib/utils/getActorFromSession', () => ({
  getActorFromSession: vi.fn().mockResolvedValue({
    id: 'https://activities.local/users/llun',
    account: { id: 'account-1' }
  })
}))
vi.mock('@/lib/services/gallery/galleryQueries', () => ({
  getGalleryMediaPage: vi.fn(),
  getGallerySubjects: vi.fn()
}))
vi.mock('@/lib/client', () => ({ getGalleryMedia: vi.fn() }))
vi.mock('@/lib/components/gallery/GalleryGrid', () => ({
  GalleryGrid: ({ items }: { items: { mediaId: string }[] }) => (
    <div data-testid="grid">{items.length}</div>
  )
}))

const renderPage = async (key: string) =>
  render(await Page({ params: Promise.resolve({ key }) }))

describe('/gallery/subjects/[key]', () => {
  beforeEach(() => {
    vi.mocked(getDatabase).mockReturnValue({} as never)
    vi.mocked(getGallerySubjects).mockResolvedValue({
      groups: [],
      unidentifiedCount: 0,
      truncated: true
    })
  })

  it('404s when the key is not indexed and there are no photos', async () => {
    vi.mocked(getGalleryMediaPage).mockResolvedValue({
      items: [],
      nextMaxId: null
    })

    await expect(renderPage('sci:nothing')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('builds the header from the first photo when the capped index misses the key', async () => {
    vi.mocked(getGalleryMediaPage).mockResolvedValue({
      items: [
        buildGalleryItem('1', {
          subject: {
            name: 'Old Bird',
            scientificName: 'Avis vetus',
            category: 'bird'
          }
        })
      ],
      nextMaxId: null
    })

    await renderPage('sci:avis vetus')

    expect(screen.getByRole('heading', { name: 'Old Bird' })).toBeVisible()
    expect(screen.getByText('Avis vetus')).toBeVisible()
    expect(screen.getByTestId('grid')).toHaveTextContent('1')
  })

  it('does not 404 an empty page that still has a next cursor', async () => {
    vi.mocked(getGalleryMediaPage).mockResolvedValue({
      items: [],
      nextMaxId: '42'
    })

    await renderPage('sci:avis vetus')

    expect(screen.getByText('avis vetus')).toBeVisible()
    expect(screen.queryByText('Unnamed subject')).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Back to subjects' })
    ).toBeInTheDocument()
  })

  it('takes the fallback header from a name: key when the first page is empty', async () => {
    vi.mocked(getGalleryMediaPage).mockResolvedValue({
      items: [],
      nextMaxId: '42'
    })

    await renderPage('name:kingfisher')

    expect(screen.getByRole('heading', { name: 'kingfisher' })).toBeVisible()
    expect(screen.queryByText('Unnamed subject')).toBeNull()
  })
})
