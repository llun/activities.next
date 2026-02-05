'use client'

import { useEffect, useState } from 'react'

import { getStatusFavouritedBy } from '@/lib/client'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'

interface UseFavouritedByParams {
  statusId: string
  limit?: number
  offset?: number
  enabled: boolean
}

interface UseFavouritedByResult {
  accounts: MastodonAccount[]
  isLoading: boolean
  totalCount: number
}

export function useFavouritedBy({
  statusId,
  limit,
  offset,
  enabled
}: UseFavouritedByParams): UseFavouritedByResult {
  const [accounts, setAccounts] = useState<MastodonAccount[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(0)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let isStale = false
    const run = async () => {
      setIsLoading(true)
      try {
        const result = await getStatusFavouritedBy({
          statusId,
          limit,
          offset
        })
        if (isStale) return

        setAccounts(result.accounts)
        setTotalCount((previous) =>
          result.total > 0 || previous === 0 ? result.total : previous
        )
      } finally {
        if (!isStale) {
          setIsLoading(false)
        }
      }
    }

    run()

    return () => {
      isStale = true
    }
  }, [statusId, limit, offset, enabled])

  return { accounts, isLoading, totalCount }
}
