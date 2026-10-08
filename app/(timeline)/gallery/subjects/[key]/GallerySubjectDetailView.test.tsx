/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { buildGalleryItem } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GallerySubjectEntry } from '@/lib/services/gallery/galleryEntities'

import { GallerySubjectDetailView } from './GallerySubjectDetailView'

vi.mock('@/lib/client', () => ({
  getGalleryMedia: vi.fn()
}))

vi.mock('@/lib/components/gallery/GalleryGrid', () => ({
  GalleryGrid: ({ items }: { items: { mediaId: string }[] }) => (
    <div data-testid="grid">{items.length}</div>
  )
}))

const subject: Omit<GallerySubjectEntry, 'cover'> = {
  key: 'sci:ramphastos sulfuratus',
  name: 'Keel-billed Toucan',
  scientificName: 'Ramphastos sulfuratus',
  category: 'bird',
  taxonKey: null,
  taxonPath: null,
  countryCodes: [],
  count: 2,
  firstSeenAt: '2025-03-14T09:30:00.000Z',
  lastSeenAt: '2025-03-16T09:30:00.000Z'
}

describe('GallerySubjectDetailView', () => {
  it('names the subject, its category and dates, and links back to subjects', () => {
    render(
      <GallerySubjectDetailView
        actorId="actor-1"
        subject={subject}
        initialPage={{
          items: [buildGalleryItem('1'), buildGalleryItem('2')],
          nextMaxId: null
        }}
      />
    )

    expect(
      screen.getByRole('link', { name: 'Back to subjects' })
    ).toHaveAttribute('href', '/gallery')
    expect(
      screen.getByRole('heading', { name: 'Keel-billed Toucan' })
    ).toBeInTheDocument()
    expect(screen.getByText('Ramphastos sulfuratus')).toHaveClass('italic')
    expect(screen.getByText('Bird')).toBeInTheDocument()
    expect(screen.getByText('14 Mar 2025')).toBeInTheDocument()
    expect(screen.getByText('16 Mar 2025')).toBeInTheDocument()
    expect(screen.getByTestId('grid')).toHaveTextContent('2')
  })

  it('falls back to the scientific name when there is no common name', () => {
    render(
      <GallerySubjectDetailView
        actorId="actor-1"
        subject={{ ...subject, name: null, category: null }}
        initialPage={{ items: [buildGalleryItem('1')], nextMaxId: null }}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Ramphastos sulfuratus' })
    ).toBeInTheDocument()
    expect(screen.queryByText('Bird')).not.toBeInTheDocument()
  })
})
