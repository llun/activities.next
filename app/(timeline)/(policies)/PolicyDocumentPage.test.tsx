/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'
import { render, screen, within } from '@testing-library/react'

import { MobileNavigationProvider } from '@/lib/components/layout/mobile-navigation-context'
import type {
  DomainIdentity,
  PolicyDocument
} from '@/lib/services/domains/domainIdentity'
import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'

import { PolicyDocumentPage } from './PolicyDocumentPage'
import PrivacyPage, {
  dynamic as privacyDynamic,
  metadata as privacyMetadata
} from './privacy-policy/page'
import TermsPage, {
  dynamic as termsDynamic,
  metadata as termsMetadata
} from './terms-of-service/page'

vi.mock('@/lib/services/domains/domainIdentity', () => ({
  getVisitedDomainIdentity: vi.fn()
}))

const notFoundError = new Error('NEXT_NOT_FOUND')
vi.mock('next/navigation', () => ({
  usePathname: () => '/terms-of-service',
  notFound: () => {
    throw notFoundError
  }
}))

const mockIdentity = vi.mocked(getVisitedDomainIdentity)

const doc = (
  markdown: string,
  updatedAt: number | null = Date.UTC(2026, 9, 20, 23, 30)
): PolicyDocument => ({ markdown, updatedAt, source: 'server' })

const identity = (overrides: Partial<DomainIdentity> = {}): DomainIdentity => ({
  domain: 'run.example',
  source: 'primary',
  name: 'Run Club',
  description: '',
  contactEmail: 'hello@run.example',
  termsOfService: doc(
    '# Terms of service\n\nWelcome to %{domain}.\n\n## Your account\n\n- one\n- two'
  ),
  privacyPolicy: doc('We keep your email.'),
  disabledFeatures: [],
  ...overrides
})

describe('PolicyDocumentPage', () => {
  beforeEach(() => {
    mockIdentity.mockReset()
    mockIdentity.mockResolvedValue(identity())
  })

  it('renders the title once, the UTC date and the rendered document', async () => {
    render(await PolicyDocumentPage({ kind: 'terms' }))

    // The leading "# Terms of service" in the source is dropped: one h1.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Terms of service' })
    ).toBeInTheDocument()
    expect(screen.getByText(/Last updated/)).toHaveTextContent(
      'Last updated 20 October 2026'
    )
    expect(screen.getByText('Welcome to run.example.')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Your account' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('omits the date when the document has none', async () => {
    mockIdentity.mockResolvedValue(
      identity({ termsOfService: doc('Plain text.', null) })
    )
    render(await PolicyDocumentPage({ kind: 'terms' }))

    expect(screen.queryByText(/Last updated/)).toBeNull()
    expect(screen.getByText('Plain text.')).toBeInTheDocument()
  })

  it('shows raw HTML as text and never emits a script', async () => {
    mockIdentity.mockResolvedValue(
      identity({
        termsOfService: doc(
          'Hi <script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>'
        )
      })
    )
    const { container } = render(await PolicyDocumentPage({ kind: 'terms' }))

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(container.textContent).toContain('<script>')
  })

  it('links the other document, the contact email and the project in the footer', async () => {
    render(await PolicyDocumentPage({ kind: 'terms' }))

    const footer = screen.getByRole('contentinfo')
    expect(
      within(footer).getByRole('link', { name: 'Privacy policy' })
    ).toHaveAttribute('href', '/privacy-policy')
    expect(
      within(footer).getByRole('link', { name: 'hello@run.example' })
    ).toHaveAttribute('href', 'mailto:hello@run.example')
    expect(
      within(footer).getByRole('link', { name: 'Activities.next' })
    ).toHaveAttribute('href', 'https://github.com/llun/activities.next')
    expect(footer.textContent).not.toContain('·')
  })

  it('links the terms from the privacy page, and leaves out what is not set', async () => {
    mockIdentity.mockResolvedValue(identity({ contactEmail: '' }))
    const { unmount } = render(await PolicyDocumentPage({ kind: 'privacy' }))

    expect(
      screen.getByRole('heading', { level: 1, name: 'Privacy policy' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Terms of service' })
    ).toHaveAttribute('href', '/terms-of-service')
    expect(screen.queryByText(/Contact/)).toBeNull()
    unmount()

    mockIdentity.mockResolvedValue(identity({ termsOfService: null }))
    render(await PolicyDocumentPage({ kind: 'privacy' }))
    expect(screen.queryByRole('link', { name: 'Terms of service' })).toBeNull()
  })

  it('shows a domain’s own text and date, or the server’s when it has none', async () => {
    const own: PolicyDocument = {
      markdown: 'Run Club terms.',
      updatedAt: Date.UTC(2026, 6, 8, 9),
      source: 'domain'
    }
    mockIdentity.mockResolvedValue(
      identity({
        source: 'database',
        termsOfService: own,
        privacyPolicy: doc('Server privacy.', null)
      })
    )

    const terms = render(await PolicyDocumentPage({ kind: 'terms' }))
    expect(screen.getByText('Run Club terms.')).toBeInTheDocument()
    expect(screen.queryByText('Welcome to run.example.')).toBeNull()
    expect(screen.getByText(/Last updated/)).toHaveTextContent(
      'Last updated 8 July 2026'
    )
    terms.unmount()

    render(await PolicyDocumentPage({ kind: 'privacy' }))
    expect(screen.getByText('Server privacy.')).toBeInTheDocument()
    expect(screen.queryByText(/Last updated/)).toBeNull()
  })

  it('is not found when the visited domain has no such document', async () => {
    mockIdentity.mockResolvedValue(identity({ termsOfService: null }))
    await expect(PolicyDocumentPage({ kind: 'terms' })).rejects.toBe(
      notFoundError
    )
    await expect(PolicyDocumentPage({ kind: 'privacy' })).resolves.toBeTruthy()
  })

  it.each(['privacy', 'terms'] as const)(
    'indexes three h2s in order on the %s page with matching native links',
    async (kind) => {
      const policy = doc(
        'Introduction.\n\n## First\n\n### Detail\n\n## Second\n\n## Third'
      )
      mockIdentity.mockResolvedValue(
        identity({ termsOfService: policy, privacyPolicy: policy })
      )
      const { container } = render(await PolicyDocumentPage({ kind }))

      const navs = screen.getAllByRole('navigation', { name: 'On this page' })
      expect(navs).toHaveLength(2)
      expect(navs[0]).toHaveClass('max-md:hidden', 'mt-6')
      expect(navs[1]).toHaveClass('md:hidden', 'mt-5')
      for (const nav of navs) {
        const links = within(nav).getAllByRole('link', { hidden: true })
        expect(links.map((link) => link.textContent)).toEqual([
          '1.First',
          '2.Second',
          '3.Third'
        ])
        expect(links.map((link) => link.getAttribute('href'))).toEqual([
          '#section-first',
          '#section-second',
          '#section-third'
        ])
        for (const link of links) {
          const id = link.getAttribute('href')!.slice(1)
          const heading = container.querySelector(`#${id}`)
          expect(heading?.tagName).toBe('H2')
          expect(heading?.textContent).toBe(link.lastElementChild?.textContent)
        }
        expect(nav.querySelector('[data-slot="frame"]')).toHaveClass(
          'rounded-lg',
          'bg-muted/40'
        )
      }
      expect(screen.getByText('3 sections')).toBeInTheDocument()
      expect(container.querySelector('details')).not.toHaveAttribute('open')
      const article = container.querySelector('article')!
      expect(article).toHaveClass('w-full', 'max-w-[560px]')
      expect(article.children[1].textContent).toContain('Last updated')
      expect(article.children[2]).toBe(navs[0])
      expect(article.children[4].textContent).toContain('Introduction.')
    }
  )

  it.each(['Plain text.', '## One\n\n### Detail\n\n## Two\n\n#### More'])(
    'omits the index with fewer than three h2s: %s',
    async (markdown) => {
      mockIdentity.mockResolvedValue(identity({ privacyPolicy: doc(markdown) }))
      const { container } = render(
        await PolicyDocumentPage({ kind: 'privacy' })
      )

      expect(
        screen.queryByRole('navigation', { name: 'On this page' })
      ).toBeNull()
      expect(container.querySelector('details')).toBeNull()
    }
  )

  it('places the index after the title when undated and escapes heading text', async () => {
    mockIdentity.mockResolvedValue(
      identity({
        privacyPolicy: doc(
          '## <b>Literal</b> &amp; **bold**\n\n## <img src=x onerror=alert(1)>\n\n## %{domain}',
          null
        )
      })
    )
    const { container } = render(await PolicyDocumentPage({ kind: 'privacy' }))

    const navs = screen.getAllByRole('navigation', { name: 'On this page' })
    expect(container.querySelector('article')?.children[1]).toBe(navs[0])
    for (const nav of navs) {
      const links = within(nav).getAllByRole('link', { hidden: true })
      expect(links[0]).toHaveTextContent('1.<b>Literal</b> & bold')
      expect(links[1]).toHaveTextContent('2.<img src=x onerror=alert(1)>')
      expect(links[2]).toHaveTextContent('3.run.example')
      expect(nav.querySelector('b, strong, img, script')).toBeNull()
    }
    expect(container.querySelector('img, script')).toBeNull()
  })
})

describe('policy routes', () => {
  it('are dynamic (they vary by host) and titled', () => {
    expect(termsDynamic).toBe('force-dynamic')
    expect(privacyDynamic).toBe('force-dynamic')
    expect(termsMetadata.title).toBe('Terms of service')
    expect(privacyMetadata.title).toBe('Privacy policy')
  })

  it('render their own document', () => {
    expect(TermsPage().props).toEqual({ kind: 'terms' })
    expect(PrivacyPage().props).toEqual({ kind: 'privacy' })
  })
})

describe('PolicyDocumentPage mobile navigation', () => {
  beforeEach(() => {
    mockIdentity.mockReset()
    mockIdentity.mockResolvedValue(identity())
  })

  it('renders the Open navigation trigger when signed in', async () => {
    render(
      <MobileNavigationProvider>
        {await PolicyDocumentPage({ kind: 'terms' })}
      </MobileNavigationProvider>
    )

    expect(
      screen.getByRole('button', { name: 'Open navigation' })
    ).toBeInTheDocument()
    // The bar is the h1 on phones; the article's h1 is hidden by the layout.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(2)
  })
})
