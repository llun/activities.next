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

describe('MediaDetailsPanel Edited row', () => {
  const EDITED_AT = '2026-10-08T10:00:00.000Z'
  const editedMs = Date.parse(EDITED_AT)
  // `editedAt` comes from the server's public details; cast so the fixture
  // does not depend on whether the entity type has it yet.
  const edited = (editedAt: string | null, overrides = {}) =>
    ({ ...details(overrides), editedAt }) as MediaPublicDetails

  it.each([
    ['the attachment has no updatedAt', undefined],
    ['the attachment was updated after the edit', editedMs + 1000],
    ['the attachment was updated at the edit', editedMs]
  ])('shows when %s', (_name, updatedAt) => {
    render(
      <MediaDetailsPanel
        details={edited(EDITED_AT)}
        attachmentUpdatedAt={updatedAt}
      />
    )
    expect(screen.getByText(/^Edited/)).toBeInTheDocument()
    expect(screen.getByText(/ago$/)).toHaveAttribute('datetime', EDITED_AT)
  })

  it('is hidden for a Gallery-only post that still shows the old photo', () => {
    render(
      <MediaDetailsPanel
        details={edited(EDITED_AT)}
        attachmentUpdatedAt={editedMs - 1000}
      />
    )
    expect(screen.queryByText(/^Edited/)).not.toBeInTheDocument()
  })

  it('is hidden when the photo was never edited', () => {
    render(<MediaDetailsPanel details={edited(null)} />)
    expect(screen.queryByText(/^Edited/)).not.toBeInTheDocument()
  })

  it('is hidden for an unreadable date', () => {
    render(<MediaDetailsPanel details={edited('not a date')} />)
    expect(screen.queryByText(/^Edited/)).not.toBeInTheDocument()
  })

  it('counts as content, matching what the panel shows', () => {
    const onlyEdited = edited(EDITED_AT, { subject: null })
    expect(hasPublicDetailsContent(onlyEdited)).toBe(true)
    expect(hasPublicDetailsContent(onlyEdited, editedMs - 1000)).toBe(false)
    expect(hasPublicDetailsContent(edited(null, { subject: null }))).toBe(false)

    const { container } = render(
      <MediaDetailsPanel
        details={onlyEdited}
        attachmentUpdatedAt={editedMs - 1000}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
