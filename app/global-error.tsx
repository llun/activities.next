'use client'

import { ErrorPage, errorBoundaryMeta } from '@/lib/components/error-page'

import './globals.css'

// Top-level error boundary. Unlike `error.tsx` it replaces the root layout, so
// it has to render its own `<html>`/`<head>`/`<body>` — including the charset,
// viewport, and document title, since `app/layout.tsx`'s metadata no longer
// applies here (without the viewport tag the page renders zoomed-out on mobile).
// Importing `globals.css` keeps the design-system tokens, fonts, and backdrop.
export default function GlobalError({
  error
}: {
  error: Error & { digest?: string }
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Something isn&apos;t working · Activities.next</title>
      </head>
      <body>
        <ErrorPage
          code="generic"
          meta={errorBoundaryMeta('unexpected error', error)}
        />
      </body>
    </html>
  )
}
