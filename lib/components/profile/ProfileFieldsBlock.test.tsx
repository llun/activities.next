/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { ProfileFieldsBlock } from './ProfileFieldsBlock'

const link = (href: string, text: string) =>
  `<a href="${href}" target="_blank" rel="nofollow noopener me">${text}</a>`

const four = [
  {
    name: 'Website',
    value: link('https://testuser.example', 'testuser.example')
  },
  {
    name: 'Photos',
    value: link('https://photos.example/@testuser', 'photos.example/@testuser')
  },
  {
    name: 'Strava',
    value: link(
      'https://fitness.example/athletes/testuser',
      'fitness.example/athletes/testuser'
    )
  },
  { name: 'Based in', value: 'Lisbon, Portugal' }
]

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

  it('renders one item per field, in order, on one list', () => {
    render(<ProfileFieldsBlock fields={four.slice(0, 2)} />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Website: testuser.example')
    expect(items[1]).toHaveTextContent('Photos: photos.example/@testuser')
    expect(document.querySelector('[data-slot="profile-fields"]')).toBe(
      items[0].parentElement
    )
  })

  it('keeps the label of a link field for screen readers and the title', () => {
    render(<ProfileFieldsBlock fields={four.slice(0, 1)} />)

    const label = screen.getByText('Website', { exact: false })
    expect(label.closest('.sr-only')).not.toBeNull()
    expect(screen.getByRole('listitem')).toHaveAttribute(
      'title',
      'Website: testuser.example'
    )
  })

  it('hides the label of a text field the icon already names', () => {
    render(<ProfileFieldsBlock fields={[four[3]]} />)

    expect(
      screen.getByText('Based in', { exact: false }).closest('.sr-only')
    ).not.toBeNull()
  })

  it('shows the label of a text field no icon names', () => {
    render(
      <ProfileFieldsBlock fields={[{ name: 'Pronouns', value: 'they/them' }]} />
    )

    const label = screen.getByText('Pronouns')
    expect(label.closest('.sr-only')).toBeNull()
    expect(label).toBeVisible()
    expect(screen.getByRole('listitem')).toHaveTextContent('Pronounsthey/them')
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

    const anchor = screen.getByRole('link')
    expect(anchor).toHaveAttribute('href', 'https://example.com/me')
    expect(anchor).toHaveAttribute('target', '_blank')
    expect(anchor.getAttribute('rel')?.split(' ')).toEqual(
      expect.arrayContaining(['me', 'nofollow', 'noopener', 'noreferrer'])
    )
    expect(anchor.querySelector('.hidden')).toHaveTextContent('https://')
  })

  it('keeps the link the person entered instead of rewriting a bridged profile', () => {
    render(
      <ProfileFieldsBlock
        fields={[
          {
            name: 'Bluesky',
            value:
              '<a href="https://bsky.app/profile/anna.example" rel="me nofollow noopener" target="_blank">bsky.app/profile/anna.example</a>'
          }
        ]}
      />
    )

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://bsky.app/profile/anna.example'
    )
  })

  it('strips scripts from a remote value', () => {
    render(
      <ProfileFieldsBlock
        fields={[{ name: 'Bad', value: 'ok<script>window.x=1</script>' }]}
      />
    )
    expect(screen.getByRole('listitem')).toHaveTextContent(/ok/)
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

    const images = within(screen.getByRole('listitem')).getAllByAltText(
      ':blobcat:'
    )
    expect(images).toHaveLength(2)
    images.forEach((image) =>
      expect(image).toHaveAttribute('src', 'https://example.com/blobcat.png')
    )
  })

  describe('verified items', () => {
    const verifiedAt = '2026-03-04T10:00:00.000Z'

    it('marks the item verified, green, and explains it in a title', () => {
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
      const item = screen.getByRole('listitem')
      expect(item).toHaveAttribute(
        'title',
        'Ownership of this link was checked on Mar 4, 2026'
      )
      expect(item.innerHTML).toContain('text-success-text')
    })

    it('shows no verified mark on an unverified item', () => {
      render(
        <ProfileFieldsBlock
          fields={[{ name: 'Web', value: 'x', verifiedAt: null }]}
        />
      )

      expect(screen.queryByLabelText('Verified')).not.toBeInTheDocument()
      expect(screen.getByRole('listitem')).toHaveAttribute('title', 'Web: x')
    })
  })

  describe('+N more', () => {
    it('has no button when everything fits', () => {
      render(<ProfileFieldsBlock fields={four.slice(0, 2)} />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('has only a phone button when exactly 3 fields', () => {
      render(<ProfileFieldsBlock fields={four.slice(0, 3)} />)

      const button = screen.getByRole('button', { name: '+1 more' })
      expect(button.closest('li')).toHaveClass('sm:hidden')
      expect(screen.getAllByRole('listitem')[2]).toHaveClass(
        'hidden',
        'sm:inline-flex'
      )
    })

    it('counts per breakpoint with 4 fields', () => {
      render(<ProfileFieldsBlock fields={four} />)

      const phone = screen.getByRole('button', { name: '+2 more' })
      const desktop = screen.getByRole('button', { name: '+1 more' })
      expect(phone).toHaveClass('sm:hidden')
      expect(desktop).toHaveClass('max-sm:hidden')

      const items = screen
        .getAllByRole('listitem')
        .filter((item) => item.getAttribute('title'))
      expect(items[0]).not.toHaveClass('hidden')
      expect(items[1]).not.toHaveClass('hidden')
      expect(items[2]).toHaveClass('hidden', 'sm:inline-flex')
      expect(items[3]).toHaveClass('hidden')
      expect(items[3]).not.toHaveClass('sm:inline-flex')
    })

    it('expands inline and collapses again', () => {
      render(<ProfileFieldsBlock fields={four} />)

      const phone = screen.getByRole('button', { name: '+2 more' })
      expect(phone).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(phone)

      const buttons = screen.getAllByRole('button', { name: 'Show less' })
      expect(buttons).toHaveLength(2)
      buttons.forEach((button) =>
        expect(button).toHaveAttribute('aria-expanded', 'true')
      )
      screen
        .getAllByRole('listitem')
        .filter((item) => item.getAttribute('title'))
        .forEach((item) => expect(item).not.toHaveClass('hidden'))

      fireEvent.click(buttons[0])
      expect(screen.getByRole('button', { name: '+2 more' })).toHaveAttribute(
        'aria-expanded',
        'false'
      )
    })
  })
})
