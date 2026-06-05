import { Metadata } from 'next'

import { ErrorPage } from '@/lib/components/error-page'

export const metadata: Metadata = {
  title: "We couldn't find that page · Activities.next"
}

export default function NotFound() {
  // Wrap in <main> for the page landmark: this renders at the root boundary
  // (above the route-group layouts), so there is no parent <main> to nest with.
  return (
    <main>
      <ErrorPage code="404" />
    </main>
  )
}
