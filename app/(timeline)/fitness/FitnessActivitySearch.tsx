'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { type FC } from 'react'

import { DebouncedSearchInput } from '@/lib/components/debounced-search-input'

import { getFitnessSearchHref } from './activityFilter'

interface FitnessActivitySearchProps {
  /** The active `?q=` words read on the server, if any. */
  query?: string
}

export const FitnessActivitySearch: FC<FitnessActivitySearchProps> = ({
  query = ''
}) => {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleSearchChange = (nextQuery: string) => {
    router.replace(getFitnessSearchHref(searchParams, nextQuery), {
      scroll: false
    })
  }

  return (
    <DebouncedSearchInput
      value={query}
      onSearchChange={handleSearchChange}
      ariaLabel="Search activities"
      placeholder="Search activities"
    />
  )
}
