import { renderToStaticMarkup } from 'react-dom/server'

import { VERSION } from '@/lib/utils/version'

import RootLayout from './layout'
import { metadata, viewport } from './layout'

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

describe('metadata', () => {
  // Pages name only themselves; the app name follows, so a narrow tab still
  // leads with the page ("Timeline · Activities.next").
  it('appends the app name to every page title', () => {
    expect(metadata.title).toEqual({
      default: 'Activities.next',
      template: '%s · Activities.next'
    })
  })

  it('exports versioned favicon and app icons to invalidate caches', () => {
    const v = encodeURIComponent(VERSION)
    expect(metadata.icons).toEqual({
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
