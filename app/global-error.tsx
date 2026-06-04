'use client'

import { ErrorPage, errorBoundaryMeta } from '@/lib/components/error-page'

import './globals.css'

// Top-level error boundary. Unlike `error.tsx` it replaces the root layout, so
// it has to render its own `<html>`/`<head>`/`<body>` — including the charset,
// viewport, and document title, since `app/layout.tsx`'s metadata no longer
// applies here (without the viewport tag the page renders zoomed-out on mobile).
// Importing `globals.css` keeps the design-system tokens, fonts, and backdrop.
// Next also passes `reset` (re-render the root). It is typed here to document
// the full boundary contract, but intentionally not wired to a retry button to
// match the design's card-only final state.
export default function GlobalError({
  error
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=2"
        />
        <title>Something isn&apos;t working · Activities.next</title>
      </head>
      <body>
        {/* global-error replaces the root layout entirely, so it owns the only
            <main> landmark on the page. */}
        <main>
          <ErrorPage
            code="generic"
            meta={errorBoundaryMeta('unexpected error', error)}
          />
        </main>
      </body>
    </html>
  )
}
