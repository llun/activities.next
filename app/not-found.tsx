import { Metadata } from 'next'

import { ErrorPage } from '@/lib/components/error-page'

export const metadata: Metadata = {
  title: "We couldn't find that page · Activities.next"
}

export default function NotFound() {
  return <ErrorPage code="404" />
}
