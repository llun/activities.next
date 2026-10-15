import { Metadata } from 'next'

import { OfflineAppShell } from '@/lib/components/offline/OfflineAppShell'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Timeline'
}

export default function AppPage() {
  return <OfflineAppShell />
}
