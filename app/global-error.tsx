'use client'

import { ErrorPage, errorBoundaryMeta } from '@/lib/components/error-page'

import './globals.css'

// Top-level error boundary. Unlike `error.tsx` it replaces the root layout, so
// it has to render its own `<html>`/`<head>`/`<body>` — including the document
// title, since `app/layout.tsx`'s metadata no longer applies here. Importing
// `globals.css` keeps the design-system tokens, fonts, and dual-tint backdrop.
export default function GlobalError({
  error
}: {
  error: Error & { digest?: string }
}) {
  return (
    <html lang="en">
      <head>
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
