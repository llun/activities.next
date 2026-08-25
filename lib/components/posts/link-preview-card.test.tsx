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

// These cards are server-rendered, so the browser starts fetching a thumbnail
// while it parses the HTML and can finish before React hydrates. `error` does
// not bubble, so a failure that landed first is never delivered to `onError`.
// jsdom loads no images, so nothing here reproduces that by itself — the
// element has to be made to report a load that already failed, which is exactly
// what the component's ref reads.
const failImagesBeforeHydration = (hasFailed: (src: string) => boolean) => {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(
    function (this: HTMLImageElement) {
      return hasFailed(this.src)
    }
  )
  vi.spyOn(
    HTMLImageElement.prototype,
    'naturalWidth',
    'get'
  ).mockImplementation(function (this: HTMLImageElement) {
    return hasFailed(this.src) ? 0 : 1280
  })
}

describe('LinkPreviewCard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  // The failure this card actually sees in production: the thumbnail 404s while
  // the HTML is still parsing, so React never delivers an `error` event and the
  // text-only fallback above never runs. It shipped broken for exactly that
  // reason — every test fired the event by hand, which real life does not.
  it('drops a thumbnail that failed before the card hydrated', () => {
    failImagesBeforeHydration(() => true)

    render(<LinkPreviewCard linkPreview={card()} />)

    expect(screen.queryByRole('presentation')).not.toBeInTheDocument()
    expect(
      screen.getByText('The best bike computers you can buy')
    ).toBeInTheDocument()
  })

  // A YouTube link renders the video itself rather than the link anatomy above.
  // Nothing is loaded from YouTube's player until the reader presses play, so
  // scrolling a timeline past a video costs neither the player code nor a
  // request that announces the reader to Google.
  describe('YouTube link', () => {
    const VIDEO_ID = 'dQw4w9WgXcQ'
    const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`
    const DERIVED_POSTER = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`

    const videoCard = (overrides: Partial<StatusLinkPreview> = {}) =>
      card({
        url: WATCH_URL,
        title: 'Never Gonna Give You Up',
        siteName: 'YouTube',
        imageUrl: `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`,
        ...overrides
      })

    const getPlayButton = () =>
      screen.getByRole('button', {
        name: 'Play video: Never Gonna Give You Up'
      })

    it('offers a play button instead of loading the player', () => {
      render(<LinkPreviewCard linkPreview={videoCard()} />)

      expect(getPlayButton()).toBeInTheDocument()
      expect(document.querySelector('iframe')).toBeNull()
    })

    it('loads the player on the cookie-light host once the reader presses play', () => {
      render(<LinkPreviewCard linkPreview={videoCard()} />)

      fireEvent.click(getPlayButton())

      const iframe = document.querySelector('iframe')
      expect(iframe).toBeInTheDocument()
      const source = new URL(iframe?.getAttribute('src') ?? '')
      expect(source.origin).toBe('https://www.youtube-nocookie.com')
      expect(source.pathname).toBe(`/embed/${VIDEO_ID}`)
      expect(
        screen.queryByRole('button', { name: /^Play video/ })
      ).not.toBeInTheDocument()
    })

    // The click IS the gesture that makes autoplay legitimate, and the frame
    // only receives it because the allow list delegates it.
    it('autoplays the player the reader asked for', () => {
      render(<LinkPreviewCard linkPreview={videoCard()} />)

      fireEvent.click(getPlayButton())

      const iframe = document.querySelector('iframe')
      expect(
        new URL(iframe?.getAttribute('src') ?? '').searchParams.get('autoplay')
      ).toBe('1')
      expect(iframe?.getAttribute('allow')).toContain('autoplay')
      expect(iframe).toHaveAttribute('allowfullscreen')
    })

    // The player deliberately does NOT carry the posters' `no-referrer`: some
    // videos are embeddable only from allowlisted domains, and withholding the
    // origin breaks them. It sits two lines from two images that DO carry it,
    // so pin the absence — otherwise harmonising the three reads as tidying up.
    it('sends the instance origin to the player rather than no referrer', () => {
      render(<LinkPreviewCard linkPreview={videoCard()} />)

      fireEvent.click(getPlayButton())

      expect(document.querySelector('iframe')).not.toHaveAttribute(
        'referrerpolicy'
      )
    })

    // The button the reader activated is the element that unmounts, so without
    // this focus lands on document.body: no signal that anything happened, and
    // the next Tab restarts from the top of the page instead of the video.
    it('moves focus onto the player it just opened', () => {
      render(<LinkPreviewCard linkPreview={videoCard()} />)

      fireEvent.click(getPlayButton())

      expect(document.activeElement).toBe(document.querySelector('iframe'))
    })

    // What makes this hold is the `key` on the video: `Posts` keys a row on the
    // status id, so without it an edit that swaps the linked video would update
    // props on the SAME mounted card and keep the frame open, starting the new
    // video under the old click's consent. The card also remembers which video
    // was played, but that is defence in depth — it passes this case and fails
    // the return trip below.
    it('returns to the facade when the post is edited to a different video', () => {
      const { rerender } = render(<LinkPreviewCard linkPreview={videoCard()} />)

      fireEvent.click(getPlayButton())
      expect(document.querySelector('iframe')).toBeInTheDocument()

      rerender(
        <LinkPreviewCard
          linkPreview={videoCard({
            url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
          })}
        />
      )

      expect(document.querySelector('iframe')).toBeNull()
      expect(
        screen.getByRole('button', { name: /^Play video/ })
      ).toBeInTheDocument()
    })

    // The return hop, which is the one that bit: consent used to be remembered
    // as "the last video played" and never cleared, so editing back to a video
    // the reader had already watched re-entered the playing branch with no
    // click — an un-consented request to YouTube, and a focus steal with it.
    it('still asks for a click when the post is edited back to a video already played', () => {
      const { rerender } = render(<LinkPreviewCard linkPreview={videoCard()} />)

      fireEvent.click(getPlayButton())
      expect(document.querySelector('iframe')).toBeInTheDocument()

      rerender(
        <LinkPreviewCard
          linkPreview={videoCard({
            url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
          })}
        />
      )
      rerender(<LinkPreviewCard linkPreview={videoCard()} />)

      expect(document.querySelector('iframe')).toBeNull()
      expect(getPlayButton()).toBeInTheDocument()
    })

    // Frames need an accessible name of their own.
    it('names the player for a screen reader', () => {
      render(<LinkPreviewCard linkPreview={videoCard()} />)

      fireEvent.click(getPlayButton())

      expect(document.querySelector('iframe')).toHaveAttribute(
        'title',
        'Never Gonna Give You Up'
      )
    })

    it('starts the player where the link says to', () => {
      render(
        <LinkPreviewCard
          linkPreview={videoCard({ url: `${WATCH_URL}&t=1h2m3s` })}
        />
      )

      fireEvent.click(getPlayButton())

      expect(
        new URL(
          document.querySelector('iframe')?.getAttribute('src') ?? ''
        ).searchParams.get('start')
      ).toBe('3723')
    })

    it('shows the title and domain beside a link out to the video', () => {
      render(<LinkPreviewCard linkPreview={videoCard()} />)

      expect(screen.getByText('Never Gonna Give You Up')).toBeInTheDocument()
      expect(screen.getByText('youtube.com')).toBeInTheDocument()

      const link = screen.getByRole('link')
      expect(link).toHaveAttribute('href', WATCH_URL)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
      expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    })

    // The poster loads before the reader has consented to anything, so it keeps
    // the same privacy posture as any other card thumbnail.
    it('loads the poster without leaking the reader to the referrer', () => {
      render(<LinkPreviewCard linkPreview={videoCard()} />)

      const poster = screen.getByRole('presentation')
      expect(poster).toHaveAttribute(
        'src',
        `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`
      )
      expect(poster).toHaveAttribute('referrerpolicy', 'no-referrer')
      expect(poster).toHaveAttribute('loading', 'lazy')
    })

    // Unlike the standard card, a video does not degrade to text: it falls back
    // to the thumbnail YouTube generates for every video, so the facade keeps a
    // real still rather than an empty box.
    it('falls back to the thumbnail YouTube generates when the stored one fails', () => {
      render(<LinkPreviewCard linkPreview={videoCard()} />)

      fireEvent.error(screen.getByRole('presentation'))

      expect(screen.getByRole('presentation')).toHaveAttribute(
        'src',
        DERIVED_POSTER
      )
      expect(getPlayButton()).toBeInTheDocument()
    })

    it('keeps the play button when no poster loads at all', () => {
      render(<LinkPreviewCard linkPreview={videoCard()} />)

      fireEvent.error(screen.getByRole('presentation'))
      fireEvent.error(screen.getByRole('presentation'))

      expect(screen.queryByRole('presentation')).not.toBeInTheDocument()
      expect(getPlayButton()).toBeInTheDocument()
    })

    // Same pre-hydration failure as the standard card, and the reason the
    // fallback chain needs more than `onError`: with only that handler the
    // facade held a broken image and never reached the derived poster.
    it('falls back when the stored poster failed before the card hydrated', () => {
      failImagesBeforeHydration((src) => src.includes('maxresdefault'))

      render(<LinkPreviewCard linkPreview={videoCard()} />)

      expect(screen.getByRole('presentation')).toHaveAttribute(
        'src',
        DERIVED_POSTER
      )
    })

    it('keeps the play button when every poster failed before hydration', () => {
      failImagesBeforeHydration(() => true)

      render(<LinkPreviewCard linkPreview={videoCard()} />)

      expect(screen.queryByRole('presentation')).not.toBeInTheDocument()
      expect(getPlayButton()).toBeInTheDocument()
    })

    it('derives the poster when the card carries no image', () => {
      render(<LinkPreviewCard linkPreview={videoCard({ imageUrl: null })} />)

      expect(screen.getByRole('presentation')).toHaveAttribute(
        'src',
        DERIVED_POSTER
      )
    })

    it('renders the title as text, never as markup', () => {
      render(
        <LinkPreviewCard
          linkPreview={videoCard({ title: '<img src=x onerror=alert(1)>' })}
        />
      )

      expect(
        screen.getByText('<img src=x onerror=alert(1)>')
      ).toBeInTheDocument()
      expect(document.querySelector('img[onerror]')).toBeNull()
    })

    // Everything that is not unambiguously one video keeps the ordinary card —
    // a look-alike host above all, which is why the branch reads the url the
    // server resolved rather than anything the page claims about itself.
    it.each([
      {
        description: 'a playlist',
        url: 'https://www.youtube.com/playlist?list=PLabcdefghij'
      },
      {
        description: 'a channel',
        url: 'https://www.youtube.com/@handle'
      },
      {
        description: 'a malformed video id',
        url: 'https://www.youtube.com/watch?v=tooshort'
      },
      {
        description: 'a look-alike host',
        url: `https://youtube.com.evil.example/watch?v=${VIDEO_ID}`
      }
    ])('keeps the standard card for $description', ({ url }) => {
      render(<LinkPreviewCard linkPreview={videoCard({ url })} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(document.querySelector('iframe')).toBeNull()
      expect(screen.getByRole('link')).toBeInTheDocument()
    })
  })
})
