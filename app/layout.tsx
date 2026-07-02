import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { Metadata, Viewport } from 'next'

import { ThemeProvider } from '@/lib/components/theme'
import { THEME_INIT_SCRIPT } from '@/lib/components/theme/theme-core'

import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 2
}

export const metadata: Metadata = {
  title: 'Activities.next',
  manifest: '/manifest.webmanifest',
  icons: {
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }
    ]
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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
