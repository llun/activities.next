/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import { buildGallerySubject } from '@/lib/components/gallery/__fixtures__/galleryItems'
import type { Attachment } from '@/lib/types/domain/attachment'

import { GallerySubjectsView } from './GallerySubjectsView'

vi.mock('@/lib/components/posts/media', () => ({
  Media: ({ attachment }: { attachment?: Attachment }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={attachment?.url} alt="" />
  )
}))

describe('GallerySubjectsView', () => {
  it('titles the page and links cards and See all into the gallery', () => {
    render(
      <GallerySubjectsView
        data={{
          groups: [
            {
              category: 'bird',
              subjects: [buildGallerySubject('sci:ramphastos sulfuratus')]
            }
          ],
          unidentifiedCount: 0,
          truncated: false
        }}
      />
    )

    expect(screen.getByText('Subjects')).toBeInTheDocument()
    expect(
      screen.getByText('Grouped by what each photo or video shows')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Keel-billed Toucan/ })
    ).toHaveAttribute('href', '/gallery/subjects/sci%3Aramphastos%20sulfuratus')
    expect(screen.getByRole('link', { name: 'See all' })).toHaveAttribute(
      'href',
      '/gallery/recent?category=bird'
    )
  })
})
