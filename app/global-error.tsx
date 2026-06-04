'use client'

import { ErrorPage } from '@/lib/components/error-page'

import './globals.css'

// Top-level error boundary. Unlike `error.tsx` it replaces the root layout, so
// it has to render its own `<html>`/`<body>`. Importing `globals.css` here keeps
// the design-system tokens, fonts, and dual-tint backdrop applied to `body`.
export default function GlobalError({
  error
}: {
  error: Error & { digest?: string }
}) {
  return (
    <html lang="en">
      <body>
        <ErrorPage
          code="generic"
          meta={error.digest ? `unexpected error · ${error.digest}` : undefined}
        />
      </body>
    </html>
  )
}
