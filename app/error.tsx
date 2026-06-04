'use client'

import { ErrorPage } from '@/lib/components/error-page'

// Route-segment error boundary. Renders the design-system 500 page; when Next
// attaches a `digest` to the error we surface it on the technical-detail line so
// it can be matched against server logs.
export default function Error({
  error
}: {
  error: Error & { digest?: string }
}) {
  return (
    <ErrorPage
      code="500"
      meta={error.digest ? `500 · ${error.digest}` : undefined}
    />
  )
}
