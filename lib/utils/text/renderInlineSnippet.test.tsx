/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { renderInlineSnippet } from './renderInlineSnippet'

describe('renderInlineSnippet', () => {
  it('returns null for empty or whitespace-only strings', () => {
    expect(renderInlineSnippet('')).toBeNull()
    expect(renderInlineSnippet('   ')).toBeNull()
    expect(renderInlineSnippet(null)).toBeNull()
    expect(renderInlineSnippet(undefined)).toBeNull()
  })

  it('renders plain text as is', () => {
    const { container } = render(
      <span>{renderInlineSnippet('Simple plain text')}</span>
    )
    expect(container).toHaveTextContent('Simple plain text')
  })

  it('renders fediverse mention without anchor or paragraph tags', () => {
    const html =
      '<p><span class="h-card" translate="no"><a href="https://llun.dev/@null" class="u-url mention">@<span>null</span></a></span> That might be the reason why suddenly Gemini 4 is good. 🤔</p>'
    const { container } = render(<span>{renderInlineSnippet(html)}</span>)

    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('p')).toBeNull()

    const mention = container.querySelector('span.text-primary')
    expect(mention).not.toBeNull()
    expect(mention).toHaveTextContent('@null')

    expect(container).toHaveTextContent(
      '@null That might be the reason why suddenly Gemini 4 is good. 🤔'
    )
  })

  it('flattens multiple block elements with space separation', () => {
    const html = '<p>First paragraph</p><p>Second paragraph</p>'
    const { container } = render(<span>{renderInlineSnippet(html)}</span>)

    expect(container.querySelector('p')).toBeNull()
    expect(container).toHaveTextContent('First paragraph Second paragraph')
  })

  it('replaces br with a space', () => {
    const html = 'Line 1<br>Line 2<br/>Line 3'
    const { container } = render(<span>{renderInlineSnippet(html)}</span>)

    expect(container.querySelector('br')).toBeNull()
    expect(container).toHaveTextContent('Line 1 Line 2 Line 3')
  })

  it('strips invisible spans and appends ellipsis for shortened links', () => {
    const html =
      '<a href="https://example.com/very/long/path"><span class="invisible">https://</span><span class="ellipsis">example.com/very/lo</span><span class="invisible">ng/path</span></a>'
    const { container } = render(<span>{renderInlineSnippet(html)}</span>)

    expect(container.querySelector('a')).toBeNull()
    const linkSpan = container.querySelector('span.text-primary')
    expect(linkSpan).not.toBeNull()
    expect(linkSpan).toHaveTextContent('example.com/very/lo…')
    expect(container).not.toHaveTextContent('https://')
    expect(container).not.toHaveTextContent('ng/path')
  })

  it('preserves formatting tags like strong, em, and code', () => {
    const html =
      '<p><strong>Bold</strong> and <em>italic</em> with <code>inline code</code></p>'
    const { container } = render(<span>{renderInlineSnippet(html)}</span>)

    expect(container.querySelector('strong')).toHaveTextContent('Bold')
    expect(container.querySelector('em')).toHaveTextContent('italic')
    expect(container.querySelector('code')).toHaveTextContent('inline code')
  })

  it('renders custom emoji images and discards non-emoji images', () => {
    const html =
      '<p>Hello <img class="emoji" src="https://example.com/emoji.png" alt=":smile:"> and <img src="https://example.com/big.jpg" alt="photo"></p>'
    const { container } = render(<span>{renderInlineSnippet(html)}</span>)

    const images = container.querySelectorAll('img')
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('src', 'https://example.com/emoji.png')
    expect(images[0]).toHaveAttribute('alt', ':smile:')
    expect(images[0]).toHaveClass(
      'size-4',
      'inline',
      'object-contain',
      'align-middle'
    )
  })
})
