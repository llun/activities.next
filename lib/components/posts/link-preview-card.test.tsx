/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'

import { LinkPreviewCard } from '@/lib/components/posts/link-preview-card'
import { StatusLinkPreview } from '@/lib/types/domain/status'

const card = (
  overrides: Partial<StatusLinkPreview> = {}
): StatusLinkPreview => ({
  url: 'https://www.theverge.com/bike-computers',
  title: 'The best bike computers you can buy',
  description: 'We tested twelve head units over three months.',
  siteName: 'The Verge',
  imageUrl: 'https://cdn.theverge.com/hero.jpg',
  ...overrides
})

describe('LinkPreviewCard', () => {
  it('renders the title, description and domain', () => {
    render(<LinkPreviewCard linkPreview={card()} />)

    expect(
      screen.getByText('The best bike computers you can buy')
    ).toBeInTheDocument()
    expect(
      screen.getByText('We tested twelve head units over three months.')
    ).toBeInTheDocument()
    expect(screen.getByText(/theverge\.com/)).toBeInTheDocument()
  })

  it('links to the page and opens it safely in a new tab', () => {
    render(<LinkPreviewCard linkPreview={card()} />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      'https://www.theverge.com/bike-computers'
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
  })

  // A card's url is author-controlled and, for a remote status, was written by
  // another server. safeExternalHref is what keeps a javascript: url from
  // becoming an href.
  it('refuses to render a javascript url as an href', () => {
    render(
      <LinkPreviewCard linkPreview={card({ url: 'javascript:alert(1)' })} />
    )

    const link = screen.queryByRole('link')
    expect(link?.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('renders the thumbnail without leaking the reader to the referrer', () => {
    render(<LinkPreviewCard linkPreview={card()} />)

    const image = screen.getByRole('presentation')
    expect(image).toHaveAttribute('src', 'https://cdn.theverge.com/hero.jpg')
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(image).toHaveAttribute('loading', 'lazy')
  })

  it('renders a text-only card when the page had no image', () => {
    render(<LinkPreviewCard linkPreview={card({ imageUrl: null })} />)

    expect(screen.queryByRole('presentation')).not.toBeInTheDocument()
    expect(
      screen.getByText('The best bike computers you can buy')
    ).toBeInTheDocument()
  })

  it('omits the description when the page had none', () => {
    render(<LinkPreviewCard linkPreview={card({ description: null })} />)

    expect(
      screen.queryByText('We tested twelve head units over three months.')
    ).not.toBeInTheDocument()
  })

  it('pairs the publisher with the domain when they differ', () => {
    render(<LinkPreviewCard linkPreview={card()} />)

    expect(screen.getByText('The Verge')).toBeInTheDocument()
    expect(screen.getByText('theverge.com')).toBeInTheDocument()
  })

  // The dot separates two things that are already separate elements, so it says
  // nothing a screen reader needs and is marked as decoration. It still has to
  // live INSIDE the name's truncating box — see the orphan case below.
  it('renders the separator as decoration inside the truncating name', () => {
    render(<LinkPreviewCard linkPreview={card()} />)

    const separator = screen.getByText('·')
    expect(separator).toHaveAttribute('aria-hidden', 'true')
    expect(separator.parentElement).toHaveTextContent('The Verge')
    expect(separator.parentElement).toHaveClass('truncate')
  })

  // The domain is the only part of the card the page cannot choose, so it is
  // the part that must survive truncation. Rendering the line as one truncated
  // string clipped the domain and kept the author's site name — a long enough
  // og:site_name pushed the real host off the end entirely.
  it('keeps the domain intact when the publisher name is very long', () => {
    render(
      <LinkPreviewCard linkPreview={card({ siteName: 'A'.repeat(255) })} />
    )

    const domain = screen.getByText('theverge.com')
    expect(domain).toBeInTheDocument()
    // The name is what gives way; the domain is kept out of the squeeze.
    expect(domain).toHaveClass('shrink-0')
    expect(screen.getByText('A'.repeat(255))).toHaveClass('truncate')
  })

  // The separator belongs to the name, so a name squeezed to nothing cannot
  // leave a line that opens with an orphan dot.
  it('does not render a separator without a publisher name', () => {
    render(<LinkPreviewCard linkPreview={card({ siteName: null })} />)

    expect(screen.queryByText('·')).not.toBeInTheDocument()
    expect(screen.getByText('theverge.com')).toBeInTheDocument()
  })

  // Hard clipping would cut the host flush; the ellipsis is the only signal
  // that what the reader is checking is not the whole domain.
  it('ellipsises rather than clips a domain that overflows on its own', () => {
    render(
      <LinkPreviewCard
        linkPreview={card({
          siteName: null,
          url: `https://${'a-very-long-subdomain.'.repeat(4)}example.com/x`
        })}
      />
    )

    const domain = screen.getByText(/example\.com/)
    expect(domain).toHaveClass('truncate')
    expect(domain).toHaveClass('max-w-full')
  })

  it('shows the domain alone when there is no publisher name', () => {
    render(<LinkPreviewCard linkPreview={card({ siteName: null })} />)

    expect(screen.getByText('theverge.com')).toBeInTheDocument()
  })

  it('renders the title as text, never as markup', () => {
    render(
      <LinkPreviewCard
        linkPreview={card({ title: '<img src=x onerror=alert(1)>' })}
      />
    )

    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(document.querySelector('img[onerror]')).toBeNull()
  })
  // A thumbnail is hotlinked from whatever host the page author chose, so it
  // can fail for reasons this server cannot see or fix (hotlink protection, a
  // dead CDN, an expired signed URL). Leaving the broken image in place holds
  // an 88px hole open in the card; dropping it degrades to the text-only card,
  // which is a card that still reads correctly.
  it('drops the thumbnail when it fails to load', () => {
    render(<LinkPreviewCard linkPreview={card()} />)

    fireEvent.error(screen.getByRole('presentation'))

    expect(screen.queryByRole('presentation')).not.toBeInTheDocument()
    expect(
      screen.getByText('The best bike computers you can buy')
    ).toBeInTheDocument()
  })
})
