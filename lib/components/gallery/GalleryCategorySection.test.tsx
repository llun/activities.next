/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { buildGallerySubject } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { Attachment } from '@/lib/types/domain/attachment'

import { GalleryCategorySection } from './GalleryCategorySection'

vi.mock('@/lib/components/posts/media', () => ({
  Media: ({ attachment }: { attachment?: Attachment }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={attachment?.url} alt="" />
  )
}))

const subjects = [
  buildGallerySubject('sci:a', { name: 'Kingfisher', count: 1 }),
  buildGallerySubject('sci:b', { name: 'Toucan', count: 4 })
]

describe('GalleryCategorySection', () => {
  it('names the section by category with a subject count', () => {
    render(
      <GalleryCategorySection
        category="bird"
        subjects={subjects}
        linkSubjects
      />
    )
    const region = screen.getByRole('region', { name: 'Birds' })
    expect(within(region).getByText('· 2 subjects')).toBeInTheDocument()
    expect(within(region).getAllByRole('link')).toHaveLength(2)
  })

  it('counts photos, not subjects, for landscapes', () => {
    render(
      <GalleryCategorySection
        category="landscape"
        subjects={subjects}
        linkSubjects
      />
    )
    expect(screen.getByText('· 5 photos')).toBeInTheDocument()
  })

  it('offers See all as a link or as a callback', () => {
    const onSeeAll = vi.fn()
    const { rerender } = render(
      <GalleryCategorySection
        category="bird"
        subjects={subjects}
        seeAllHref="/gallery/recent?category=bird"
      />
    )
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute(
      'href',
      '/gallery/recent?category=bird'
    )

    rerender(
      <GalleryCategorySection
        category="bird"
        subjects={subjects}
        onSeeAll={onSeeAll}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'See all' }))
    expect(onSeeAll).toHaveBeenCalledTimes(1)
  })

  it('has no See all without a destination', () => {
    render(<GalleryCategorySection category="bird" subjects={subjects} />)
    expect(screen.queryByText('See all')).not.toBeInTheDocument()
  })
})
