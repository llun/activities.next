/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it } from 'vitest'

import { renderInlineSnippet } from './renderInlineSnippet'

describe('renderInlineSnippet', () => {
  it.each([
    { description: 'an empty string', input: '' },
    { description: 'whitespace only', input: '   ' },
    { description: 'null', input: null },
    { description: 'undefined', input: undefined }
  ])('renders nothing for $description', ({ input }) => {
    expect(renderInlineSnippet(input)).toBeNull()
  })

  it('renders plain text as is', () => {
    const { container } = render(
      <span>{renderInlineSnippet('Simple plain text')}</span>
    )
    expect(container).toHaveTextContent('Simple plain text')
  })

  it('renders a fediverse mention as text with no link or paragraph', () => {
    const html =
      '<p><span class="h-card" translate="no"><a href="https://llun.dev/@null" class="u-url mention">@<span>null</span></a></span> That might be the reason why suddenly Gemini 4 is good. 🤔</p>'
    const { container } = render(<span>{renderInlineSnippet(html)}</span>)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container).toHaveTextContent(
      '@null That might be the reason why suddenly Gemini 4 is good. 🤔'
    )
  })

  it.each([
    {
      description: 'separates paragraphs with a space',
      html: '<p>First paragraph</p><p>Second paragraph</p>',
      expected: 'First paragraph Second paragraph'
    },
    {
      description: 'turns line breaks into spaces',
      html: 'Line 1<br>Line 2<br/>Line 3',
      expected: 'Line 1 Line 2 Line 3'
    },
    {
      description: 'drops the hidden parts of a shortened link',
      html: '<a href="https://example.com/very/long/path"><span class="invisible">https://</span><span class="ellipsis">example.com/very/lo</span><span class="invisible">ng/path</span></a>',
      expected: 'example.com/very/lo…'
    }
  ])('$description', ({ html, expected }) => {
    const { container } = render(<span>{renderInlineSnippet(html)}</span>)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container.textContent?.trim()).toBe(expected)
  })

  it('keeps inline formatting', () => {
    render(
      <span>
        {renderInlineSnippet(
          '<p><strong>Bold</strong> and <em>italic</em> with <code>inline code</code></p>'
        )}
      </span>
    )

    expect(screen.getByText('Bold').tagName).toBe('STRONG')
    expect(screen.getByText('italic').tagName).toBe('EM')
    expect(screen.getByText('inline code').tagName).toBe('CODE')
  })

  it('keeps custom emoji and drops other images', () => {
    render(
      <span>
        {renderInlineSnippet(
          '<p>Hello <img class="emoji" src="https://example.com/emoji.png" alt=":smile:"> and <img src="https://example.com/big.jpg" alt="photo"></p>'
        )}
      </span>
    )

    expect(screen.getByRole('img', { name: ':smile:' })).toHaveAttribute(
      'src',
      'https://example.com/emoji.png'
    )
    expect(screen.queryByRole('img', { name: 'photo' })).not.toBeInTheDocument()
  })
})
