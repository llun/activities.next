/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom'
import { fireEvent, render } from '@testing-library/react'
import React from 'react'

import { cleanClassName } from './cleanClassName'

describe('cleanClassName', () => {
  describe('link handling', () => {
    it('adds target="_blank" to links', () => {
      const html = '<a href="https://test.local/page">Link</a>'
      const result = cleanClassName(html)
      const { container } = render(<div>{result}</div>)

      const link = container.querySelector('a')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('adds onClick handler that stops propagation', () => {
      const html = '<a href="https://test.local/page">Link</a>'
      const result = cleanClassName(html)

      const parentClickHandler = jest.fn()
      const { container } = render(
        <div onClick={parentClickHandler}>{result}</div>
      )

      const link = container.querySelector('a')
      expect(link).toBeTruthy()

      // Click the link
      fireEvent.click(link!)

      // Parent click handler should NOT have been called
      expect(parentClickHandler).not.toHaveBeenCalled()
    })

    it('preserves link href attribute', () => {
      const html = '<a href="https://test.local/page">Link</a>'
      const result = cleanClassName(html)
      const { container } = render(<div>{result}</div>)

      const link = container.querySelector('a')
      expect(link).toHaveAttribute('href', 'https://test.local/page')
    })

    it('preserves link content', () => {
      const html = '<a href="https://test.local/page">Click here</a>'
      const result = cleanClassName(html)
      const { container } = render(<div>{result}</div>)

      const link = container.querySelector('a')
      expect(link).toHaveTextContent('Click here')
    })

    it('handles links with nested elements', () => {
      const html =
        '<a href="https://test.local/page"><span>Nested</span> content</a>'
      const result = cleanClassName(html)

      const parentClickHandler = jest.fn()
      const { container } = render(
        <div onClick={parentClickHandler}>{result}</div>
      )

      const link = container.querySelector('a')
      expect(link).toBeTruthy()

      // Click the link
      fireEvent.click(link!)

      // Parent click handler should NOT have been called
      expect(parentClickHandler).not.toHaveBeenCalled()
    })

    it('handles multiple links in content', () => {
      const html =
        '<p><a href="https://test.local/first">First</a> and <a href="https://test.local/second">Second</a></p>'
      const result = cleanClassName(html)

      const parentClickHandler = jest.fn()
      const { container } = render(
        <div onClick={parentClickHandler}>{result}</div>
      )

      const links = container.querySelectorAll('a')
      expect(links).toHaveLength(2)

      // Click the first link
      fireEvent.click(links[0])
      expect(parentClickHandler).not.toHaveBeenCalled()

      // Click the second link
      fireEvent.click(links[1])
      expect(parentClickHandler).not.toHaveBeenCalled()
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

      const parentClickHandler = jest.fn()
      const { container } = render(
        <div onClick={parentClickHandler}>{result}</div>
      )

      // Verify link stopPropagation still works
      const link = container.querySelector('a')
      fireEvent.click(link!)
      expect(parentClickHandler).not.toHaveBeenCalled()

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

  describe('complex content', () => {
    it('handles mixed content with links, spans, and emojis', () => {
      const html =
        '<p>Check out <a href="https://test.local/link">this link</a> and <span class="invisible">hidden</span> <img class="emoji" src="emoji.png" alt="emoji"></p>'
      const result = cleanClassName(html)

      const parentClickHandler = jest.fn()
      const { container } = render(
        <div onClick={parentClickHandler}>{result}</div>
      )

      // Verify link has stopPropagation
      const link = container.querySelector('a')
      fireEvent.click(link!)
      expect(parentClickHandler).not.toHaveBeenCalled()

      // Verify span class conversion
      const span = container.querySelector('span')
      expect(span).toHaveClass('hidden')

      // Verify emoji class conversion
      const img = container.querySelector('img')
      expect(img).toHaveClass('size-5')
      expect(img).toHaveClass('inline')
    })
  })
})
