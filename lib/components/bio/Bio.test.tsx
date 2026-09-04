/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react'

import { Bio } from './Bio'

describe('Bio', () => {
  it('renders plain text summary', () => {
    render(<Bio summary="Hello world" />)
    expect(screen.getByText('Hello world')).toBeDefined()
  })

  it('renders sanitized HTML links in summary', () => {
    const { container } = render(
      <Bio summary='<p>Visit <a href="https://example.com">website</a></p>' />
    )
    const link = container.querySelector('a')
    expect(link).toBeDefined()
    expect(link?.getAttribute('href')).toBe('https://example.com')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.textContent).toBe('website')
  })

  it('converts custom emoji shortcodes to images using tags', () => {
    const { container } = render(
      <Bio
        summary="<p>Hello :blobcat: world</p>"
        tags={[
          {
            type: 'emoji',
            name: ':blobcat:',
            value: 'https://example.com/blobcat.png'
          }
        ]}
      />
    )
    const img = container.querySelector('img')
    expect(img).toBeDefined()
    expect(img?.getAttribute('src')).toBe('https://example.com/blobcat.png')
    expect(img?.getAttribute('alt')).toBe(':blobcat:')
    expect(img?.className).toContain('size-5 inline')
  })

  it('converts custom emoji shortcodes to images using emojis', () => {
    const { container } = render(
      <Bio
        summary="<p>Hello :partyblob:</p>"
        emojis={[
          {
            shortcode: 'partyblob',
            url: 'https://example.com/partyblob.png'
          }
        ]}
      />
    )
    const img = container.querySelector('img')
    expect(img).toBeDefined()
    expect(img?.getAttribute('src')).toBe('https://example.com/partyblob.png')
    expect(img?.getAttribute('alt')).toBe(':partyblob:')
    expect(img?.className).toContain('size-5 inline')
  })
})
