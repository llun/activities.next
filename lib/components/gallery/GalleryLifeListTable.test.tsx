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
  counts: { species: 2, groups: 0, unknown: 1 },
  countsByCategory: {
    bird: { species: 1, groups: 0, unknown: 1 },
    mammal: { species: 1, groups: 0, unknown: 0 }
  },
  byCategory: { bird: 2, mammal: 1 },
  entries: [
    buildLifeListEntry('sci:alcedo atthis', {
      name: 'Common Kingfisher',
      taxonRank: 'SPECIES',
      identificationLevel: 'species',
      scientificName: 'Alcedo atthis',
      count: 1,
      firstSeenAt: '2025-03-14T09:30:00.000Z',
      firstPlaceName: 'Khao Yai, Thailand'
    }),
    buildLifeListEntry('sci:vulpes vulpes', {
      name: 'Red Fox',
      taxonRank: 'SPECIES',
      identificationLevel: 'species',
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
    expect(within(rows[0]).getByText('Alcedo atthis')).toBeInTheDocument()
    expect(within(rows[0]).getByText('14 Mar 2025')).toBeInTheDocument()
    expect(within(rows[1]).getByText('9')).toBeInTheDocument()
    expect(within(rows[2]).getAllByRole('cell')[0]).toHaveTextContent('–')
    expect(within(rows[2]).getByText('Unconfirmed')).toBeInTheDocument()
  })

  it('shows where each species was first seen, and a dash when no place is shown', () => {
    render(<GalleryLifeListTable data={data} />)

    const rows = screen.getAllByRole('row').slice(1)
    // Once in the Where cell and once under the name on a narrow screen.
    expect(within(rows[0]).getAllByText(/Khao Yai, Thailand/)).toHaveLength(2)
    expect(within(rows[1]).queryByText(/·/)).toBeNull()
    expect(within(rows[1]).getByText('No place')).toBeInTheDocument()
  })

  it('labels the columns', () => {
    render(<GalleryLifeListTable data={data} />)
    for (const name of [
      '#',
      'Name',
      'Scientific name',
      'First seen',
      'Where',
      'Photos'
    ]) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument()
    }
  })

  it('totals species and photos and shows the biggest categories', () => {
    render(<GalleryLifeListTable data={data} />)
    const species = screen.getByText('Species').closest('dl')!
    expect(species).toHaveTextContent('2')
    const photos = screen.getByText('Photos', { selector: 'dt' }).closest('dl')!
    expect(photos).toHaveTextContent('12')
    expect(
      screen.getByText('Birds', { selector: 'dt' }).closest('dl')
    ).toHaveTextContent('1')
    expect(
      screen.getByText('Mammals', { selector: 'dt' }).closest('dl')
    ).toHaveTextContent('1')
  })

  it('marks totals as a lower bound and says so when truncated', () => {
    render(<GalleryLifeListTable data={{ ...data, truncated: true }} />)
    expect(screen.getByText('2+')).toBeInTheDocument()
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

it('numbers only species through interleaved groups, with labels beside the name', () => {
  render(
    <GalleryLifeListTable
      data={{
        ...data,
        total: 5,
        counts: { species: 2, groups: 2, unknown: 1 },
        entries: [
          data.entries[0],
          buildLifeListEntry('pongo', {
            name: 'Pongo',
            taxonRank: 'GENUS',
            identificationLevel: 'group'
          }),
          data.entries[1],
          buildLifeListEntry('family', {
            name: 'Corvidae',
            taxonRank: 'FAMILY',
            identificationLevel: 'group'
          }),
          data.entries[2]
        ]
      }}
    />
  )
  const rows = screen.getAllByRole('row').slice(1)
  expect(
    rows.map((row) => within(row).getAllByRole('cell')[0].textContent)
  ).toEqual([
    '1',
    '–Not a confirmed species',
    '2',
    '–Not a confirmed species',
    '–Not a confirmed species'
  ])
  expect(within(rows[1]).getByText('Genus')).toBeInTheDocument()
  expect(within(rows[3]).getByText('Family')).toBeInTheDocument()
})
it('treats an older response without counts as all unknown, even with stray classification fields', () => {
  render(
    <GalleryLifeListTable
      data={{ ...data, counts: undefined, countsByCategory: undefined }}
    />
  )
  expect(screen.getByText('Species').closest('dl')).toHaveTextContent('0')
  expect(
    screen.getByText('Unconfirmed', { selector: 'dt' }).closest('dl')
  ).toHaveTextContent('3')
  expect(
    screen.getAllByText('Unconfirmed', { selector: '[data-slot=badge]' })
  ).toHaveLength(3)
  expect(screen.queryByText('Birds', { selector: 'dt' })).toBeNull()
})
