import { Metadata } from 'next'

import { PolicyDocumentPage } from '@/app/(timeline)/(policies)/PolicyDocumentPage'

// The document, its date and the domain named in it depend on the visited
// host, so the page is never cached across hosts.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Privacy policy'
}

const Page = () => <PolicyDocumentPage kind="privacy" />

export default Page
