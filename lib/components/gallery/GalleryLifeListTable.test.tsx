/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { buildLifeListEntry } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GalleryLifeListResponse } from '@/lib/services/gallery/galleryEntities'

import { GalleryLifeListTable } from './GalleryLifeListTable'

const data: GalleryLifeListResponse = {
  total: 3,
  byCategory: { bird: 2, mammal: 1 },
  entries: [
    buildLifeListEntry('sci:alcedo atthis', {
      name: 'Common Kingfisher',
      scientificName: 'Alcedo atthis',
      count: 1,
      firstSeenAt: '2025-03-14T09:30:00.000Z'
    }),
    buildLifeListEntry('sci:vulpes vulpes', {
      name: 'Red Fox',
      scientificName: 'Vulpes vulpes',
      category: 'mammal',
      count: 9,
      firstSeenAt: '2025-06-02T09:30:00.000Z'
    }),
    buildLifeListEntry('name:mystery bird', {
      name: 'Mystery bird',
      scientificName: null,
      count: 2,
      firstSeenAt: null
    })
  ],
  truncated: false
}

describe('GalleryLifeListTable', () => {
  it('lists species in the order given, numbered, with first seen and photos', () => {
    render(<GalleryLifeListTable data={data} />)

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getAllByRole('cell')[0]).toHaveTextContent('1')
    expect(within(rows[0]).getByText('Common Kingfisher')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Alcedo atthis')).toHaveClass('italic')
    expect(within(rows[0]).getByText('14 Mar 2025')).toBeInTheDocument()
    expect(within(rows[1]).getByText('9')).toBeInTheDocument()
    expect(within(rows[2]).getAllByRole('cell')[0]).toHaveTextContent('3')
  })

  it('labels the columns', () => {
    render(<GalleryLifeListTable data={data} />)
    for (const name of [
      '#',
      'Name',
      'Scientific name',
      'First seen',
      'Photos'
    ]) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }
  })

  it('totals species and photos and shows the biggest categories', () => {
    render(<GalleryLifeListTable data={data} />)
    const species = screen.getByText('Species').closest('dl')!
    expect(species).toHaveTextContent('3')
    const photos = screen.getByText('Photos', { selector: 'dt' }).closest('dl')!
    expect(photos).toHaveTextContent('12')
    expect(
      screen.getByText('Birds', { selector: 'dt' }).closest('dl')
    ).toHaveTextContent('2')
    expect(
      screen.getByText('Mammals', { selector: 'dt' }).closest('dl')
    ).toHaveTextContent('1')
  })

  it('marks totals as a lower bound and says so when truncated', () => {
    render(<GalleryLifeListTable data={{ ...data, truncated: true }} />)
    expect(screen.getByText('3+')).toBeInTheDocument()
    expect(screen.getByText(/Counts are a lower bound/)).toBeInTheDocument()
  })

  it('links names to subject pages on owner pages', () => {
    render(<GalleryLifeListTable data={data} linkSubjects />)
    expect(screen.getByRole('link', { name: 'Red Fox' })).toHaveAttribute(
      'href',
      '/gallery/subjects/sci%3Avulpes%20vulpes'
    )
  })

  it('filters in place from the profile tab', () => {
    const onSelectSubject = vi.fn()
    render(
      <GalleryLifeListTable data={data} onSelectSubject={onSelectSubject} />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Red Fox' }))
    expect(onSelectSubject).toHaveBeenCalledWith('sci:vulpes vulpes', 'Red Fox')
  })
})
