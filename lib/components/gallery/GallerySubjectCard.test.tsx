/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { buildGallerySubject } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { Attachment } from '@/lib/types/domain/attachment'

import { GallerySubjectCard, getGallerySubjectHref } from './GallerySubjectCard'

vi.mock('@/lib/components/posts/media', () => ({
  Media: ({ attachment }: { attachment?: Attachment }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={attachment?.url} alt="" />
  )
}))

describe('GallerySubjectCard', () => {
  it('shows the cover thumbnail, name, italic scientific name and count', () => {
    render(<GallerySubjectCard subject={buildGallerySubject('a')} href="/x" />)

    expect(screen.getByText('Keel-billed Toucan')).toBeInTheDocument()
    expect(screen.getByText('Ramphastos sulfuratus')).toHaveClass('italic')
    expect(screen.getByText('2 photos')).toHaveClass('sr-only')
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      'https://activities.local/media/cover-a-thumb.jpg'
    )
  })

  it('says "1 photo" for a single photo', () => {
    render(
      <GallerySubjectCard
        subject={buildGallerySubject('a', { count: 1 })}
        href="/x"
      />
    )
    expect(screen.getByText('1 photo')).toBeInTheDocument()
  })

  it('links to the subject page with the key percent-encoded', () => {
    const key = 'sci:ramphastos sulfuratus'
    render(
      <GallerySubjectCard
        subject={buildGallerySubject(key)}
        href={getGallerySubjectHref(key)}
      />
    )
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/gallery/subjects/sci%3Aramphastos%20sulfuratus'
    )
  })

  it('filters in place with a button when there is no href', () => {
    const onSelect = vi.fn()
    render(
      <GallerySubjectCard
        subject={buildGallerySubject('name:toucan')}
        onSelect={onSelect}
      />
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('name:toucan', 'Keel-billed Toucan')
  })

  it('falls back to the scientific name, and omits it twice, for an unnamed common name', () => {
    render(
      <GallerySubjectCard
        subject={buildGallerySubject('a', { name: null })}
        href="/x"
      />
    )
    expect(screen.getAllByText('Ramphastos sulfuratus')).toHaveLength(1)
  })
})
