/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

import type { MediaPublicDetails } from '@/lib/services/gallery/galleryEntities'

import {
  MediaDetailsPanel,
  hasPublicDetailsContent
} from './media-details-panel'

const details = (
  overrides: Partial<MediaPublicDetails> = {}
): MediaPublicDetails => ({
  subject: {
    name: 'Common Kingfisher',
    scientificName: 'Alcedo atthis',
    category: 'bird',
    taxonKey: '2475532',
    taxonPath: ['Animalia', 'Chordata', 'Aves', 'Coraciiformes', 'Alcedinidae']
  },
  takenAt: null,
  camera: null,
  lens: null,
  exposure: null,
  place: null,
  ...overrides
})

describe('MediaDetailsPanel taxonomy', () => {
  it('shows the taxonomy path under the scientific name', () => {
    render(<MediaDetailsPanel details={details()} />)

    expect(screen.getByText('Alcedo atthis')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Animalia › Chordata › Aves › Coraciiformes › Alcedinidae'
      )
    ).toBeInTheDocument()
  })

  it('links the scientific-name hashtag to the fediverse tag page', () => {
    render(<MediaDetailsPanel details={details()} />)

    expect(screen.getByRole('link', { name: '#AlcedoAtthis' })).toHaveAttribute(
      'href',
      '/tags/AlcedoAtthis'
    )
    expect(screen.getByText(/on the fediverse/)).toBeInTheDocument()
  })

  it('names the owner who confirmed the subject, in place of the category pill', () => {
    render(<MediaDetailsPanel details={details()} ownerName="Mali" />)

    expect(screen.getByText(/confirmed by Mali/)).toHaveTextContent(
      'bird · confirmed by Mali'
    )
    // The category is in that line, not repeated as a pill.
    expect(screen.queryByText('bird')).not.toBeInTheDocument()
  })

  it('keeps the category pill when the owner is not known', () => {
    render(<MediaDetailsPanel details={details()} />)

    expect(screen.getByText('bird')).toBeInTheDocument()
    expect(screen.queryByText(/confirmed by/)).not.toBeInTheDocument()
  })

  it('has no tag or path for a subject with a one-word name and no path', () => {
    render(
      <MediaDetailsPanel
        details={details({
          subject: {
            name: 'Lake',
            scientificName: null,
            category: 'landscape',
            taxonKey: null,
            taxonPath: null
          }
        })}
        ownerName="Mali"
      />
    )

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText(/›/)).not.toBeInTheDocument()
    expect(screen.getByText(/confirmed by Mali/)).toBeInTheDocument()
  })

  it('does not claim a confirmation when there is no subject', () => {
    const noSubject = details({
      subject: null,
      camera: { name: 'Nikon Z8' }
    })
    render(<MediaDetailsPanel details={noSubject} ownerName="Mali" />)

    expect(screen.queryByText(/confirmed by/)).not.toBeInTheDocument()
    expect(hasPublicDetailsContent(noSubject)).toBe(true)
  })
})
