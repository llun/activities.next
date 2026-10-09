/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render } from '@testing-library/react'
import React from 'react'

import { cleanClassName } from './cleanClassName'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: {
    children: React.ReactNode
    href: string
    prefetch?: boolean
    [key: string]: unknown
  }) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  )
}))

describe('cleanClassName', () => {
  describe('link handling', () => {
    it('rewrites profile links to local route without target="_blank" and with prefetch=false', () => {
      const html =
        '<a href="https://mastodon.social/@remoteuser" class="mention">@remoteuser</a>'
      const result = cleanClassName(html, { host: 'activities.local' })
      const parentClickHandler = vi.fn()
      const { container } = render(
        <div onClick={parentClickHandler}>{result}</div>
      )

      const link = container.querySelector('a')
      expect(link).toHaveAttribute('href', '/@remoteuser@mastodon.social')
      expect(link).not.toHaveAttribute('target')
      expect(link).not.toHaveAttribute('rel')
      expect(link).toHaveAttribute('data-prefetch', 'false')

      fireEvent.click(link!)
      expect(parentClickHandler).not.toHaveBeenCalled()
    })

    it('keeps YouTube @channel links external with target="_blank" and preserves rel', () => {
      const html =
        '<p><a href="https://youtube.com/@babylon5" rel="nofollow">https://youtube.com/@babylon5</a></p>'
      const result = cleanClassName(html, { host: 'activities.local' })
      const { container } = render(<div>{result}</div>)

      const link = container.querySelector('a')
      expect(link).toHaveAttribute('href', 'https://youtube.com/@babylon5')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'nofollow noopener noreferrer')
      expect(link).not.toHaveAttribute('data-prefetch')
    })

    it.each([
      {
        description: 'a plain link',
        html: '<a href="https://test.local/page">Link</a>',
        linkCount: 1
      },
      {
        description: 'a link with nested elements',
        html: '<a href="https://test.local/page"><span>Nested</span> content</a>',
        linkCount: 1
      },
      {
        description: 'multiple links in content',
        html: '<p><a href="https://test.local/first">First</a> and <a href="https://test.local/second">Second</a></p>',
        linkCount: 2
      },
      {
        description: 'a profile link',
        html: '<a href="https://mastodon.social/@alice" class="mention">@alice</a>',
        linkCount: 1
      }
    ])('stops click propagation on $description', ({ html, linkCount }) => {
      const parentClickHandler = vi.fn()
      const { container } = render(
        <div onClick={parentClickHandler}>{cleanClassName(html)}</div>
      )

      const links = container.querySelectorAll('a')
      expect(links).toHaveLength(linkCount)
      links.forEach((link) => fireEvent.click(link))

      expect(parentClickHandler).not.toHaveBeenCalled()
    })

    it('preserves the href, content and class of a link', () => {
      const html =
        '<a href="https://test.local/page" class="mention">Click here</a>'
      const result = cleanClassName(html)
      const { container } = render(<div>{result}</div>)

      const link = container.querySelector('a')
      expect(link).toHaveAttribute('href', 'https://test.local/page')
      expect(link).toHaveTextContent('Click here')
      expect(link).toHaveClass('mention')
    })
  })

  describe('span class handling', () => {
    it('converts "invisible" class to "hidden"', () => {
      const html = '<span class="invisible">Hidden text</span>'
      const result = cleanClassName(html)
      const { container } = render(<div>{result}</div>)

      const span = container.querySelector('span')
      expect(span).toHaveClass('hidden')
      expect(span).not.toHaveClass('invisible')
    })

    it('converts "ellipsis" class to after:content-["…"]', () => {
      const html = '<span class="ellipsis">Truncated</span>'
      const result = cleanClassName(html)
      const { container } = render(<div>{result}</div>)

      const span = container.querySelector('span')
      expect(span).toHaveClass('after:content-["…"]')
      expect(span).not.toHaveClass('ellipsis')
    })
  })

  describe('emoji handling', () => {
    it('converts emoji img class to "size-5 inline"', () => {
      const html = '<img class="emoji" src="emoji.png" alt="emoji">'
      const result = cleanClassName(html)
      const { container } = render(<div>{result}</div>)

      const img = container.querySelector('img')
      expect(img).toHaveClass('size-5')
      expect(img).toHaveClass('inline')
      expect(img).not.toHaveClass('emoji')
    })

    it('converts emoji inside anchor tags', () => {
      const html =
        '<a href="https://test.local/page"><img class="emoji" src="emoji.png" alt="emoji"></a>'
      const result = cleanClassName(html)
      const { container } = render(<div>{result}</div>)

      const img = container.querySelector('img')
      expect(img).toHaveClass('size-5')
      expect(img).toHaveClass('inline')
      expect(img).not.toHaveClass('emoji')
    })
  })

  describe('nested element transformations in links', () => {
    it('preserves span class transformations inside anchor tags', () => {
      const html =
        '<a href="https://test.local/page"><span class="invisible">hidden text</span></a>'
      const result = cleanClassName(html)
      const { container } = render(<div>{result}</div>)

      const span = container.querySelector('span')
      expect(span).toHaveClass('hidden')
      expect(span).not.toHaveClass('invisible')
    })

    it('handles ellipsis span inside anchor tags', () => {
      const html =
        '<a href="https://test.local/page"><span class="ellipsis">truncated</span></a>'
      const result = cleanClassName(html)
      const { container } = render(<div>{result}</div>)

      const span = container.querySelector('span')
      expect(span).toHaveClass('after:content-["…"]')
      expect(span).not.toHaveClass('ellipsis')
    })

    it('handles multiple nested elements in anchor with transformations', () => {
      const html =
        '<a href="https://test.local/page">Text <span class="invisible">hidden</span> <img class="emoji" src="emoji.png" alt="emoji"> more text</a>'
      const result = cleanClassName(html)

      const { container } = render(<div>{result}</div>)

      // Verify span class conversion
      const span = container.querySelector('span')
      expect(span).toHaveClass('hidden')
      expect(span).not.toHaveClass('invisible')

      // Verify emoji class conversion
      const img = container.querySelector('img')
      expect(img).toHaveClass('size-5')
      expect(img).toHaveClass('inline')
      expect(img).not.toHaveClass('emoji')
    })
  })
})
