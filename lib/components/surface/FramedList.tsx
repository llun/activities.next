import Link from 'next/link'
import { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

import { Frame } from './Frame'

/** The standard padding of a list row, shared with `TableFrame`'s first cell. */
export const FRAMED_LIST_ITEM_CLASS = 'px-4 py-3'

interface FramedListProps {
  /** A bar under the rows: a "Show more" control, a count. */
  footer?: ReactNode
  /** The faint `bg-muted/40` panel instead of the page background. */
  muted?: boolean
  className?: string
  /** `FramedListItem`s. */
  children: ReactNode
  'aria-label'?: string
  'aria-labelledby'?: string
}

/**
 * Every list is one frame with hairlines between its rows, never separate
 * cards: the shape Home and the Fitness recent activities already have.
 */
export const FramedList: FC<FramedListProps> = ({
  footer,
  muted,
  className,
  children,
  ...aria
}) => (
  <Frame
    footer={footer}
    muted={muted}
    className={cn('overflow-hidden', className)}
  >
    <ul className="divide-y" {...aria}>
      {children}
    </ul>
  </Frame>
)

interface FramedListItemProps {
  /** Turns the whole row into a link with a hover state. */
  href?: string
  className?: string
  children: ReactNode
}

/** One row of a `FramedList`. */
export const FramedListItem: FC<FramedListItemProps> = ({
  href,
  className,
  children
}) => (
  <li>
    {href ? (
      <Link
        href={href}
        className={cn(
          'hover:bg-muted focus-visible:ring-ring/50 block outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-inset',
          FRAMED_LIST_ITEM_CLASS,
          className
        )}
      >
        {children}
      </Link>
    ) : (
      <div className={cn(FRAMED_LIST_ITEM_CLASS, className)}>{children}</div>
    )}
  </li>
)
