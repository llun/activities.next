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
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('https://example.com')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.textContent).toBe('website')
  })

  it.each([
    [
      'tags',
      {
        summary: '<p>Hello :blobcat: world</p>',
        tags: [
          {
            type: 'emoji' as const,
            name: ':blobcat:',
            value: 'https://example.com/blobcat.png'
          }
        ]
      },
      'https://example.com/blobcat.png',
      ':blobcat:'
    ],
    [
      'emojis',
      {
        summary: '<p>Hello :partyblob:</p>',
        emojis: [
          {
            shortcode: 'partyblob',
            url: 'https://example.com/partyblob.png'
          }
        ]
      },
      'https://example.com/partyblob.png',
      ':partyblob:'
    ]
  ])(
    'converts custom emoji shortcodes to images using %s',
    (_input, props, src, alt) => {
      const { container } = render(<Bio {...props} />)
      const img = container.querySelector('img')
      expect(img?.getAttribute('src')).toBe(src)
      expect(img?.getAttribute('alt')).toBe(alt)
    }
  )
})
