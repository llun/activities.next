'use client'

import { useRouter } from 'next/navigation'
import { FC, useTransition } from 'react'

import { RefreshButton } from '@/lib/components/refresh-button'

/**
 * The reload control for a server-rendered list that can go stale (the admin
 * queues, notifications): it re-renders the page's server components in place
 * (`router.refresh()`) and spins while that runs.
 */
export const PageRefreshButton: FC<{ accessibleName: string }> = ({
  accessibleName
}) => {
  const router = useRouter()
  const [refreshing, startTransition] = useTransition()
  return (
    <RefreshButton
      accessibleName={accessibleName}
      refreshing={refreshing}
      onRefresh={() => startTransition(() => router.refresh())}
    />
  )
}
