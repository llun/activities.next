'use client'

import { ErrorPage, errorBoundaryMeta } from '@/lib/components/error-page'

// Route-segment error boundary. Renders the design-system 500 page; when Next
// attaches a `digest` to the error we surface it on the technical-detail line so
// it can be matched against server logs (and the raw message in development).
//
// Next also passes `reset` (re-render the segment). It is typed here to document
// the full boundary contract, but intentionally not wired to a retry button —
// the design's final state is a card with no actions.
export default function Error({
  error
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Wrap in <main> for the page landmark: this root boundary renders inside the
  // root layout (which has no <main>), so there is no nesting risk.
  return (
    <main>
      <ErrorPage code="500" meta={errorBoundaryMeta('500', error)} />
    </main>
  )
}
