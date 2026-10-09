import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { FC, ReactNode } from 'react'

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
  className?: string
}

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
          <Link href={previousHref}>
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
          <Link href={nextHref}>
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
