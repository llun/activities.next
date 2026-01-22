import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { Metadata, Viewport } from 'next'

import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 2
}

export const metadata: Metadata = {
  title: 'Activities.next'
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
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
