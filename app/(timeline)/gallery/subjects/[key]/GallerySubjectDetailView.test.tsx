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

  describe('taxonomy', () => {
    const identified = {
      ...subject,
      taxonKey: '2481017',
      taxonPath: ['Animalia', 'Chordata', 'Aves', 'Piciformes', 'Ramphastidae'],
      countryCodes: ['CR']
    }
    const render_ = (
      overrides: Partial<Parameters<typeof GallerySubjectDetailView>[0]> = {}
    ) =>
      render(
        <GallerySubjectDetailView
          actorId="actor-1"
          subject={identified}
          initialPage={{ items: [buildGalleryItem('1')], nextMaxId: null }}
          commonTag="KeelBilledToucan"
          where="Costa Rica"
          {...overrides}
        />
      )

    it('shows the path, a GBIF link and the follow link', () => {
      render_()

      expect(
        screen.getByText(
          'Animalia › Chordata › Aves › Piciformes › Ramphastidae'
        )
      ).toBeInTheDocument()
      const gbif = screen.getByRole('link', { name: /GBIF/ })
      expect(gbif).toHaveAttribute(
        'href',
        'https://www.gbif.org/species/2481017'
      )
      expect(gbif).toHaveAttribute('rel', 'noopener noreferrer')
      expect(gbif).toHaveAttribute('target', '_blank')
      expect(
        screen.getByRole('link', { name: 'Follow #RamphastosSulfuratus' })
      ).toHaveAttribute('href', '/tags/RamphastosSulfuratus')
    })

    it('shows where the subject was seen, as the server named it', () => {
      const { unmount } = render_()
      expect(
        screen.getByText('Where', { selector: 'dt' }).closest('dl')
      ).toHaveTextContent('Costa Rica')
      unmount()

      // Named on the server, not here: the view never runs Intl itself.
      render_({ where: 'Costa Rica, Panama, Mexico +2' })
      expect(screen.getByText('Costa Rica, Panama, Mexico +2')).toBeVisible()
    })

    it('offers a card that browses the posts under both hashtags', () => {
      render_()

      expect(
        screen.getByRole('heading', {
          name: 'More Keel-billed Toucans on the fediverse'
        })
      ).toBeInTheDocument()
      expect(
        screen.getByText(
          'Posts tagged #RamphastosSulfuratus or #KeelBilledToucan.'
        )
      ).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: 'Browse posts' })
      ).toHaveAttribute('href', '/tags/RamphastosSulfuratus')
    })

    it('writes a scientific name as it is, never pluralized', () => {
      render_({
        subject: { ...identified, name: null },
        commonTag: null
      })

      const heading = screen.getByRole('heading', {
        name: 'More Ramphastos sulfuratus on the fediverse'
      })
      expect(heading.querySelector('.italic')).toHaveTextContent(
        'Ramphastos sulfuratus'
      )
    })

    it('falls back to the common-name tag when there is no scientific name', () => {
      render_({
        subject: {
          ...identified,
          scientificName: null,
          taxonKey: null,
          taxonPath: null,
          countryCodes: []
        },
        where: null
      })

      expect(
        screen.getByRole('link', { name: 'Browse posts' })
      ).toHaveAttribute('href', '/tags/KeelBilledToucan')
      expect(screen.queryByText(/Follow #/)).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: /GBIF/ })
      ).not.toBeInTheDocument()
      expect(screen.queryByText('Where', { selector: 'dt' })).toBeNull()
    })

    it('shows none of it for a subject with no tag to follow', () => {
      render_({
        subject: {
          ...identified,
          name: 'Lake',
          scientificName: null,
          taxonKey: null,
          taxonPath: null,
          countryCodes: []
        },
        commonTag: null
      })

      expect(screen.queryByText(/on the fediverse/)).not.toBeInTheDocument()
    })
  })
})
