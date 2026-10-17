/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { ProfileFieldsBlock } from './ProfileFieldsBlock'

describe('ProfileFieldsBlock', () => {
  it('renders nothing without fields', () => {
    const { container } = render(<ProfileFieldsBlock fields={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when every field is blank', () => {
    const { container } = render(
      <ProfileFieldsBlock fields={[{ name: ' ', value: '' }]} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a labelled row per field in a framed, divided list', () => {
    render(
      <ProfileFieldsBlock
        fields={[
          { name: 'Pronouns', value: 'they/them' },
          { name: 'Location', value: 'Bangkok' }
        ]}
      />
    )

    const terms = screen.getAllByRole('term')
    expect(terms.map((term) => term.textContent)).toEqual([
      'Pronouns',
      'Location'
    ])
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual(
      ['they/them', 'Bangkok']
    )
    const frame = terms[0].closest('dl')
    expect(frame).toHaveClass(
      'divide-y',
      'overflow-hidden',
      'rounded-lg',
      'border'
    )
  })

  it('opens a link in a new tab with rel me and hides the invisible parts', () => {
    render(
      <ProfileFieldsBlock
        fields={[
          {
            name: 'Web',
            value:
              '<a href="https://example.com/me" target="_blank" rel="nofollow noopener me" translate="no"><span class="invisible">https://</span><span class="">example.com/me</span><span class="invisible"></span></a>'
          }
        ]}
      />
    )

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://example.com/me')
    expect(link).toHaveAttribute('target', '_blank')
    const rel = link.getAttribute('rel')?.split(' ')
    expect(rel).toEqual(
      expect.arrayContaining(['me', 'nofollow', 'noopener', 'noreferrer'])
    )
    expect(link.querySelector('.hidden')).toHaveTextContent('https://')
  })

  it('strips scripts from a remote value', () => {
    render(
      <ProfileFieldsBlock
        fields={[{ name: 'Bad', value: 'ok<script>window.x=1</script>' }]}
      />
    )
    expect(screen.getByRole('definition')).toHaveTextContent(/^ok/)
    expect(document.querySelector('script')).toBeNull()
  })

  it('shows a custom emoji in the label and the value', () => {
    render(
      <ProfileFieldsBlock
        fields={[{ name: ':blobcat: Cat', value: 'likes :blobcat:' }]}
        tags={[
          {
            type: 'emoji',
            name: ':blobcat:',
            value: 'https://example.com/blobcat.png'
          }
        ]}
      />
    )

    expect(
      within(screen.getByRole('term')).getByAltText(':blobcat:')
    ).toHaveAttribute('src', 'https://example.com/blobcat.png')
    expect(
      within(screen.getByRole('definition')).getByRole('img')
    ).toHaveAttribute('src', 'https://example.com/blobcat.png')
  })

  describe('verified rows', () => {
    const verifiedAt = '2026-03-04T10:00:00.000Z'

    it('tints the row, marks it verified and explains it in a title', () => {
      render(
        <ProfileFieldsBlock
          fields={[
            {
              name: 'Web',
              value: '<a href="https://example.com">example.com</a>',
              verifiedAt
            }
          ]}
        />
      )

      expect(screen.getByLabelText('Verified')).toBeInTheDocument()
      const definition = screen.getByRole('definition')
      expect(definition).toHaveAttribute(
        'title',
        'Ownership of this link was checked on Mar 4, 2026'
      )
      expect(definition).toHaveClass('[&_a]:text-success-text')
      expect(definition.parentElement).toHaveClass('bg-success/10')
      expect(screen.getByRole('term')).not.toHaveClass('sm:bg-muted/40')
    })

    it('leaves an unverified row plain', () => {
      render(
        <ProfileFieldsBlock
          fields={[{ name: 'Web', value: 'x', verifiedAt: null }]}
        />
      )

      expect(screen.queryByLabelText('Verified')).not.toBeInTheDocument()
      expect(screen.getByRole('definition')).not.toHaveAttribute('title')
      expect(screen.getByRole('term')).toHaveClass('sm:bg-muted/40')
    })
  })
})
