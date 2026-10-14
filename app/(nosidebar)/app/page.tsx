import { Metadata } from 'next'

import { OfflineAppShell } from '@/lib/components/offline/OfflineAppShell'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Activities.next: App'
}

export default function AppPage() {
  return <OfflineAppShell />
}
