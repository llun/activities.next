import { renderToStaticMarkup } from 'react-dom/server'

import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { VERSION } from '@/lib/utils/version'

import RootLayout from './layout'
import { generateMetadata, viewport } from './layout'

// The titles name the domain the page is visited on.
vi.mock('@/lib/services/domains/domainIdentity', () => ({
  getVisitedDomainIdentity: vi.fn()
}))

const anIdentity = (domain: string, name: string) => ({
  domain,
  source: 'database' as const,
  name,
  description: '',
  contactEmail: '',
  termsOfService: null,
  privacyPolicy: null,
  disabledFeatures: []
})

vi.mock('@/lib/components/navigation-history/InAppHistoryTracker', () => ({
  InAppHistoryTracker: () => <span data-testid="in-app-history-tracker" />
}))

vi.mock('@/lib/components/web-vitals/WebVitals', () => ({
  WebVitals: () => <span data-testid="web-vitals" />
}))

vi.mock('@/lib/components/theme', () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children
}))

describe('RootLayout', () => {
  // The post page's history Back reads what the tracker records, so it has to
  // be mounted above every route group. Without it, every Back falls back to
  // "Back to profile" and nothing else fails.
  it('mounts the in-app history tracker around every page', () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main data-testid="page" />
      </RootLayout>
    )

    const body = markup.slice(markup.indexOf('<body'))
    expect(body).toContain('data-testid="in-app-history-tracker"')
    expect(body).toContain('data-testid="page"')
  })
})

describe('RootLayout web vitals', () => {
  // The reporter decides for itself whether it is on (the sample rate is read
  // per request); the layout only has to mount its gate on every page.
  it('mounts the Web Vitals gate in the body', () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <main />
      </RootLayout>
    )

    expect(markup.slice(markup.indexOf('<body'))).toContain(
      'data-testid="web-vitals"'
    )
  })
})

describe('generateMetadata', () => {
  beforeEach(() => {
    vi.mocked(getVisitedDomainIdentity).mockReset()
    vi.mocked(getVisitedDomainIdentity).mockResolvedValue(
      anIdentity('test.llun.dev', 'Activities.next')
    )
  })

  // Pages name only themselves; the domain's name follows, so a narrow tab
  // still leads with the page ("Timeline · Run Club").
  it.each([
    {
      description: 'the primary, named in Admin › Server settings',
      identity: anIdentity('test.llun.dev', 'Activities.next'),
      expected: 'Activities.next'
    },
    {
      description: 'a served domain with its own name',
      identity: anIdentity('run.example', 'Run Club'),
      expected: 'Run Club'
    },
    {
      description: 'a domain with a blank name, after the domain',
      identity: anIdentity('run.example', ''),
      expected: 'run.example'
    }
  ])(
    'appends the name of $description to every page title',
    async ({ identity, expected }) => {
      vi.mocked(getVisitedDomainIdentity).mockResolvedValue(identity)

      const metadata = await generateMetadata()

      expect(metadata.title).toEqual({
        default: expected,
        template: `%s · ${expected}`
      })
    }
  )

  it('keeps a literal %s in the name out of the title template', async () => {
    vi.mocked(getVisitedDomainIdentity).mockResolvedValue(
      anIdentity('run.example', '100%s Club')
    )

    const { title } = await generateMetadata()
    const { template } = title as { template: string }

    // Next fills the template with `template.replace(/%s/g, pageTitle)`.
    expect(template.replace(/%s/g, 'Timeline')).toBe(
      'Timeline · 100%\u200Bs Club'
    )
    expect(title).toMatchObject({ default: '100%s Club' })
  })

  it('links the web app manifest', async () => {
    expect((await generateMetadata()).manifest).toBe('/manifest.webmanifest')
  })

  it('exports versioned favicon and app icons to invalidate caches', async () => {
    const v = encodeURIComponent(VERSION)
    expect((await generateMetadata()).icons).toEqual({
      icon: [
        { url: `/favicon.ico?v=${v}`, sizes: 'any' },
        { url: `/icon-192.png?v=${v}`, sizes: '192x192', type: 'image/png' }
      ],
      shortcut: [`/favicon.ico?v=${v}`],
      apple: [
        {
          url: `/apple-touch-icon.png?v=${v}`,
          sizes: '180x180',
          type: 'image/png'
        }
      ]
    })
  })
})

describe('viewport', () => {
  // Without `cover`, iOS Safari stops the page at the safe area and, from iOS
  // 26, leaves a solid band under its floating address bar; every
  // `env(safe-area-inset-*)` the app pads by also reads 0.
  it('covers the whole screen so the safe-area insets are real', () => {
    expect(viewport.viewportFit).toBe('cover')
  })
})
