/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { buildGallerySubject } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { GallerySubjectsResponse } from '@/lib/services/gallery/galleryEntities'
import type { Attachment } from '@/lib/types/domain/attachment'

import { GallerySubjectsOverview } from './GallerySubjectsOverview'

vi.mock('@/lib/components/posts/media', () => ({
  Media: ({ attachment }: { attachment?: Attachment }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={attachment?.url} alt="" />
  )
}))

const data: GallerySubjectsResponse = {
  groups: [
    {
      category: 'bird',
      subjects: [
        buildGallerySubject('sci:a', { name: 'Kingfisher', count: 3 }),
        buildGallerySubject('sci:b', { name: 'Toucan', count: 2 })
      ]
    },
    {
      category: 'landscape',
      subjects: [
        buildGallerySubject('name:lakes', {
          name: 'Lakes',
          scientificName: null,
          category: 'landscape',
          count: 9
        })
      ]
    }
  ],
  unidentifiedCount: 4,
  countryCount: null,
  truncated: false
}

describe('GallerySubjectsOverview', () => {
  it('totals photos and species (landscapes are not species) and the unidentified', () => {
    render(<GallerySubjectsOverview data={data} />)

    const photos = screen
      .getByText('Photos and videos', { selector: 'dt' })
      .closest('dl')
    expect(photos).toHaveTextContent('18')
    expect(
      screen.getByText('Species', { selector: 'dt' }).closest('dl')
    ).toHaveTextContent('2')
    expect(
      screen.getByText('Without a subject', { selector: 'dt' }).closest('dl')
    ).toHaveTextContent('4')
  })

  it('leaves the Places cell out when no country is known', () => {
    render(<GallerySubjectsOverview data={data} mapHref="/gallery/map" />)

    expect(screen.queryByText('Places', { selector: 'dt' })).toBeNull()
    expect(screen.queryByText(/Open map/)).toBeNull()
  })

  it('shows the countries with an Open map link on owner pages', () => {
    render(
      <GallerySubjectsOverview
        data={{ ...data, countryCount: 7 }}
        mapHref="/gallery/map"
      />
    )

    expect(
      screen.getByText('Places', { selector: 'dt' }).closest('dl')
    ).toHaveTextContent('7 countries')
    const link = screen.getByRole('link', { name: 'Open map ›' })
    expect(link).toHaveAttribute('href', '/gallery/map')
  })

  it('says 1 country in the singular and opens the map in place on the profile', () => {
    const onOpenMap = vi.fn()
    render(
      <GallerySubjectsOverview
        data={{ ...data, countryCount: 1 }}
        onOpenMap={onOpenMap}
      />
    )

    expect(
      screen.getByText('Places', { selector: 'dt' }).closest('dl')
    ).toHaveTextContent('1 country')
    fireEvent.click(screen.getByRole('button', { name: 'Open map ›' }))
    expect(onOpenMap).toHaveBeenCalledOnce()
  })

  it('shows the countries without a link when there is nowhere to open', () => {
    render(<GallerySubjectsOverview data={{ ...data, countryCount: 2 }} />)

    expect(screen.getByText('2 countries')).toBeInTheDocument()
    expect(screen.queryByText(/Open map/)).toBeNull()
  })

  it('shows every category section, then only the chosen one', () => {
    render(<GallerySubjectsOverview data={data} />)
    expect(screen.getByRole('region', { name: 'Birds' })).toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'Landscapes' })
    ).toBeInTheDocument()

    const group = screen.getByRole('group', { name: 'Filter by category' })
    expect(group).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Landscapes/ }))

    expect(screen.queryByRole('region', { name: 'Birds' })).toBeNull()
    expect(
      screen.getByRole('region', { name: 'Landscapes' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Landscapes/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('region', { name: 'Birds' })).toBeInTheDocument()
  })

  it('passes the chosen subject and category up for in-place filtering', () => {
    const onSelectSubject = vi.fn()
    const onSeeAll = vi.fn()
    render(
      <GallerySubjectsOverview
        data={data}
        onSelectSubject={onSelectSubject}
        onSeeAll={onSeeAll}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Kingfisher/ }))
    expect(onSelectSubject).toHaveBeenCalledWith('sci:a', 'Kingfisher')

    fireEvent.click(screen.getAllByRole('button', { name: 'See all' })[0])
    expect(onSeeAll).toHaveBeenCalledWith('bird')
  })

  it('links See all with the owner href builder and cards to subject pages', () => {
    render(
      <GallerySubjectsOverview
        data={data}
        linkSubjects
        getSeeAllHref={(category) => `/gallery/recent?category=${category}`}
      />
    )
    expect(screen.getAllByRole('link', { name: 'See all' })[0]).toHaveAttribute(
      'href',
      '/gallery/recent?category=bird'
    )
  })

  it('gives subjects with no category an Other subjects section without See all', () => {
    render(
      <GallerySubjectsOverview
        data={{
          groups: [
            {
              category: 'unidentified',
              subjects: [buildGallerySubject('name:x', { category: null })]
            }
          ],
          unidentifiedCount: 0,
          countryCount: null,
          truncated: false
        }}
        onSeeAll={vi.fn()}
      />
    )
    expect(
      screen.getByRole('region', { name: 'Other subjects' })
    ).toBeInTheDocument()
    expect(screen.queryByText('See all')).not.toBeInTheDocument()
  })

  it('explains an empty gallery', () => {
    render(
      <GallerySubjectsOverview
        data={{
          groups: [],
          unidentifiedCount: 0,
          countryCount: null,
          truncated: false
        }}
      />
    )
    expect(
      screen.getByText('No photos in your gallery yet')
    ).toBeInTheDocument()
  })

  it('says counts are a lower bound when truncated', () => {
    render(<GallerySubjectsOverview data={{ ...data, truncated: true }} />)
    expect(screen.getByText(/Counts are a lower bound/)).toBeInTheDocument()
  })
})
