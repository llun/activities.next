/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'

import { GalleryAlbumHero } from './GalleryAlbumHero'

vi.mock('@/lib/components/posts/media', () => ({
  Media: ({ attachment }: { attachment?: { url: string } }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={attachment?.url} alt="" data-testid="cover" />
  )
}))

describe('GalleryAlbumHero', () => {
  it('puts the title, dates and country over the cover', () => {
    render(
      <GalleryAlbumHero
        title="Kruger"
        cover={buildGalleryItem('c1')}
        dateRange="12 – 19 Sep 2026"
        countryName="South Africa"
      />
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Kruger' })
    ).toBeVisible()
    expect(
      screen.getByText('12 – 19 Sep 2026 · South Africa')
    ).toBeInTheDocument()
    expect(screen.getByTestId('cover')).toBeInTheDocument()
  })

  it('leaves out the country when there is none, and the subtitle when nothing is dated', () => {
    const { rerender } = render(
      <GalleryAlbumHero
        title="Kruger"
        cover={buildGalleryItem('c1')}
        dateRange="12 Sep 2026"
        countryName={null}
      />
    )
    expect(screen.getByText('12 Sep 2026')).toBeInTheDocument()

    rerender(
      <GalleryAlbumHero
        title="Kruger"
        cover={buildGalleryItem('c1')}
        dateRange=""
        countryName="South Africa"
      />
    )
    expect(screen.queryByText(/South Africa/)).not.toBeInTheDocument()
  })

  it('is a plain heading when no photo is visible to use as a cover', () => {
    render(
      <GalleryAlbumHero
        title="Kruger"
        cover={null}
        dateRange="12 Sep 2026"
        countryName={null}
      />
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Kruger' })
    ).toBeVisible()
    expect(screen.queryByTestId('cover')).not.toBeInTheDocument()
    expect(screen.getByText('12 Sep 2026')).toBeInTheDocument()
  })
})
