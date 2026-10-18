'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { FC, MouseEvent, ReactNode } from 'react'

import { Button } from '@/lib/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  /** Where the position is said: "Page 2 of 5", "Showing 1-100 of 250". */
  label: ReactNode
  /** The link to the previous page; absent on the first page. */
  previousHref?: string
  /** The link to the next page; absent on the last page. */
  nextHref?: string
  /** Names the landmark when a page has more than one list to page through. */
  navLabel?: string
  onPreviousClick?: () => void
  onNextClick?: () => void
  className?: string
}

const isPlainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button === 0 &&
  !event.defaultPrevented &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey

/**
 * Previous and Next under a list's frame, with where you are on the left. An
 * end of the list shows the button disabled rather than gone, so the controls
 * do not jump between pages.
 */
export const Pagination: FC<Props> = ({
  label,
  previousHref,
  nextHref,
  navLabel = 'Pagination',
  onPreviousClick,
  onNextClick,
  className
}) => (
  <nav
    aria-label={navLabel}
    className={cn(
      'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
      className
    )}
  >
    <p className="text-muted-foreground text-sm">{label}</p>
    <div className="flex gap-2">
      {previousHref ? (
        <Button asChild variant="outline" size="sm">
          <Link
            href={previousHref}
            onClick={(event) => {
              if (isPlainClick(event)) {
                onPreviousClick?.()
              }
            }}
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Link>
        </Button>
      ) : (
        <Button disabled variant="outline" size="sm">
          <ChevronLeft aria-hidden="true" />
          Previous
        </Button>
      )}
      {nextHref ? (
        <Button asChild variant="outline" size="sm">
          <Link
            href={nextHref}
            onClick={(event) => {
              if (isPlainClick(event)) {
                onNextClick?.()
              }
            }}
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <Button disabled variant="outline" size="sm">
          Next
          <ChevronRight aria-hidden="true" />
        </Button>
      )}
    </div>
  </nav>
)
