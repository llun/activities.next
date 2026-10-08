/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { buildLifeListEntry } from '@/lib/components/gallery/__fixtures__/galleryItems'

import { GalleryLifeListView } from './GalleryLifeListView'

describe('GalleryLifeListView', () => {
  it('shows the table with links to subject pages', () => {
    render(
      <GalleryLifeListView
        data={{
          total: 1,
          byCategory: { bird: 1 },
          entries: [buildLifeListEntry('sci:alcedo atthis')],
          truncated: false
        }}
      />
    )
    expect(
      screen.getByText(
        'Every species you have photographed, first sighting first'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Keel-billed Toucan' })
    ).toHaveAttribute('href', '/gallery/subjects/sci%3Aalcedo%20atthis')
  })

  it('explains an empty life list', () => {
    render(
      <GalleryLifeListView
        data={{ total: 0, byCategory: {}, entries: [], truncated: false }}
      />
    )
    expect(screen.getByText('No species yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
