import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'

import { InAppHistoryTracker } from '@/lib/components/navigation-history/InAppHistoryTracker'
import { ServiceWorkerRegistration } from '@/lib/components/offline/ServiceWorkerRegistration'
import { ThemeProvider } from '@/lib/components/theme'
import { THEME_INIT_SCRIPT } from '@/lib/components/theme/theme-core'
import { WebVitals } from '@/lib/components/web-vitals/WebVitals'
import { getDomainDisplayName } from '@/lib/services/domains/domainDisplayName'
import { getVisitedDomainIdentity } from '@/lib/services/domains/domainIdentity'
import { withVersion } from '@/lib/utils/version'

import './globals.css'

// `viewportFit: 'cover'` lets the page run edge to edge. Without it iOS
// Safari stops the layout viewport at the safe area, so from iOS 26 its
// floating address bar sits on a solid band below the page, and every
// `env(safe-area-inset-*)` in the app reads 0. With it the insets are real,
// so whatever must stay clear of the notch, the home indicator or the bar
// pads by them (see `.safe-area-*` in globals.css).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 2,
  viewportFit: 'cover'
}

const icons: Metadata['icons'] = {
  icon: [
    { url: withVersion('/favicon.ico'), sizes: 'any' },
    { url: withVersion('/icon-192.png'), sizes: '192x192', type: 'image/png' }
  ],
  shortcut: [withVersion('/favicon.ico')],
  apple: [
    {
      url: withVersion('/apple-touch-icon.png'),
      sizes: '180x180',
      type: 'image/png'
    }
  ]
}

// Pages set only their own name ("Timeline", "Notifications") and the
// template appends the name of the domain the page is visited on (Admin ›
// Domains, else Admin › Server settings), so a narrow tab leads with the page. Safari
// trims a leading site name from tab titles, so the old "Activities.next: App"
// on the home shell showed as a bare "App". Reading the visited host makes
// every page request-time, which they already were (see `yarn build`'s route
// table); the server settings and domain identity caches keep most of them
// off the database.
// Next fills the template with `template.replace(/%s/g, pageTitle)` and has no
// escape for a literal `%s`, so a name such as "100%s Club" would swallow the
// page title. A zero-width space between the two characters keeps it visibly
// the same and stops it matching.
const escapeTitleTemplate = (name: string) => name.replace(/%s/g, '%\u200Bs')

export const generateMetadata = async (): Promise<Metadata> => {
  const name = getDomainDisplayName(await getVisitedDomainIdentity())
  return {
    title: {
      default: name,
      template: `%s · ${escapeTitleTemplate(name)}`
    },
    manifest: '/manifest.webmanifest',
    icons
  }
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  const span = trace.getActiveSpan()
  if (span) {
    span.setStatus({ code: SpanStatusCode.OK })
  }

  return (
    // suppressHydrationWarning: the anti-FOUC script below sets the `.dark` class
    // and `color-scheme` on <html> before hydration, so the server markup (no
    // class) legitimately differs from the client's first paint.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the persisted theme in <head> so it runs before the body is
            parsed — eliminating any flash of light mode for dark-mode users.
            Runs synchronously ahead of the bundle. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          {/* Lets a history-based Back tell an in-app return from a direct
              entry; spans every route group, renders nothing. */}
          <InAppHistoryTracker />
          <ServiceWorkerRegistration />
          {/* Mounts the sampled Web Vitals reporter, and only while
              ACTIVITIES_WEB_VITALS_SAMPLE_RATE is above zero; renders nothing
              otherwise. Its own boundary keeps it off the page's critical
              path. */}
          <Suspense fallback={null}>
            <WebVitals />
          </Suspense>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
