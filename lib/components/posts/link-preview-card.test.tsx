/** @vitest-environment jsdom */
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'

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

    expect(screen.getByText('The Verge · theverge.com')).toBeInTheDocument()
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
})
