/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'

import { ActorDisplayName, CustomEmojiText } from './ActorDisplayName'

describe('ActorDisplayName', () => {
  it('renders null when name is not provided', () => {
    const { container } = render(<ActorDisplayName name={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders plain text when no tags or emojis are provided', () => {
    render(<ActorDisplayName name="Alice" />)
    expect(screen.getByText('Alice')).toBeDefined()
  })

  it('renders plain text when tags do not match any shortcode in name', () => {
    render(
      <ActorDisplayName
        name="Alice"
        tags={[
          {
            type: 'emoji',
            name: ':blobcat:',
            value: 'https://example.com/blobcat.png'
          }
        ]}
      />
    )
    expect(screen.getByText('Alice')).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('renders custom emoji image when tag matches shortcode in name', () => {
    render(
      <ActorDisplayName
        name="Alice :blobcat:"
        tags={[
          {
            type: 'emoji',
            name: ':blobcat:',
            value: 'https://example.com/blobcat.png'
          }
        ]}
      />
    )
    const img = screen.getByRole('img', { name: ':blobcat:' })
    expect(img).toBeDefined()
    expect(img.getAttribute('src')).toBe('https://example.com/blobcat.png')
    expect(img.getAttribute('title')).toBe(':blobcat:')
    expect(screen.getByText(/Alice/)).toBeDefined()
  })

  it('supports emojis prop from Mastodon accounts', () => {
    render(
      <ActorDisplayName
        name=":partyblob: Bob"
        emojis={[
          {
            shortcode: 'partyblob',
            url: 'https://example.com/partyblob.png'
          }
        ]}
      />
    )
    const img = screen.getByRole('img', { name: ':partyblob:' })
    expect(img).toBeDefined()
    expect(img.getAttribute('src')).toBe('https://example.com/partyblob.png')
    expect(screen.getByText(/Bob/)).toBeDefined()
  })

  it('renders multiple custom emojis in name while leaving unknown shortcodes as text', () => {
    render(
      <ActorDisplayName
        name=":blobcat: Alice and :partyblob: Bob :unknown:"
        tags={[
          {
            type: 'emoji',
            name: ':blobcat:',
            value: 'https://example.com/blobcat.png'
          },
          {
            type: 'emoji',
            name: ':partyblob:',
            value: 'https://example.com/partyblob.png'
          }
        ]}
      />
    )
    const imgs = screen.getAllByRole('img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0].getAttribute('src')).toBe('https://example.com/blobcat.png')
    expect(imgs[1].getAttribute('src')).toBe(
      'https://example.com/partyblob.png'
    )
    expect(screen.getByText(/:unknown:/)).toBeDefined()
  })

  it('applies custom className when provided', () => {
    const { container } = render(
      <ActorDisplayName
        name="Alice :blobcat:"
        className="custom-title-class"
        tags={[
          {
            type: 'emoji',
            name: ':blobcat:',
            value: 'https://example.com/blobcat.png'
          }
        ]}
      />
    )
    expect(container.querySelector('.custom-title-class')).not.toBeNull()
  })

  it('supports text prop via CustomEmojiText export', () => {
    render(
      <CustomEmojiText
        text="Content Warning :blobcat:"
        tags={[
          {
            type: 'emoji',
            name: ':blobcat:',
            value: 'https://example.com/blobcat.png'
          }
        ]}
      />
    )
    const img = screen.getByRole('img', { name: ':blobcat:' })
    expect(img).toBeDefined()
    expect(img.getAttribute('src')).toBe('https://example.com/blobcat.png')
    expect(screen.getByText(/Content Warning/)).toBeDefined()
  })
})
