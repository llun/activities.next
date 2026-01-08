'use client'

import Link from 'next/link'
import { FC } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  currentPage: number
  totalPages: number
  basePath: string
}

export const Pagination: FC<Props> = ({
  currentPage,
  totalPages,
  basePath
}) => {
  if (totalPages <= 1) return null

  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    const showEllipsis = totalPages > 7

    if (!showEllipsis) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      pages.push(1)

      if (currentPage > 3) {
        pages.push('...')
      }

      for (
        let i = Math.max(2, currentPage - 1);
        i <= Math.min(totalPages - 1, currentPage + 1);
        i++
      ) {
        if (!pages.includes(i)) {
          pages.push(i)
        }
      }

      if (currentPage < totalPages - 2) {
        pages.push('...')
      }

      if (!pages.includes(totalPages)) {
        pages.push(totalPages)
      }
    }

    return pages
  }

  const pages = getPageNumbers()

  return (
    <nav
      className="flex items-center justify-center gap-1"
      aria-label="Pagination"
    >
      {currentPage > 1 && (
        <Link
          href={`${basePath}?page=${currentPage - 1}`}
          className={cn(
            'px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors',
            'border border-input bg-background'
          )}
        >
          Previous
        </Link>
      )}

      {pages.map((page, index) =>
        typeof page === 'number' ? (
          <Link
            key={page}
            href={`${basePath}?page=${page}`}
            className={cn(
              'px-3 py-2 text-sm rounded-md transition-colors',
              page === currentPage
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent border border-input bg-background'
            )}
          >
            {page}
          </Link>
        ) : (
          <span
            key={`ellipsis-${index}`}
            className="px-2 text-muted-foreground"
          >
            {page}
          </span>
        )
      )}

      {currentPage < totalPages && (
        <Link
          href={`${basePath}?page=${currentPage + 1}`}
          className={cn(
            'px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors',
            'border border-input bg-background'
          )}
        >
          Next
        </Link>
      )}
    </nav>
  )
}
