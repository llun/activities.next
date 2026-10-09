import { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  /** A bar under the content, set off by a top border: a `SaveBar`, a note. */
  footer?: ReactNode
  /** The faint `bg-muted/40` panel instead of the page background. */
  muted?: boolean
  /** Hairline `divide-y` rules between the children (form rows, list rows). */
  divided?: boolean
  className?: string
  children: ReactNode
}

/**
 * The one flat surface: `rounded-lg border bg-background`, no shadow. Content
 * that belongs together (a settings form's rows, a list's rows, a chart) sits
 * in one Frame, with `divided` drawing the hairlines between its children.
 */
export const Frame: FC<Props> = ({
  footer,
  muted = false,
  divided = false,
  className,
  children
}) => (
  <div
    data-slot="frame"
    className={cn(
      'rounded-lg border',
      muted ? 'bg-muted/40' : 'bg-background',
      className
    )}
  >
    {divided ? <div className="divide-y">{children}</div> : children}
    {footer ? (
      <div data-slot="frame-footer" className="border-t px-4 py-3">
        {footer}
      </div>
    ) : null}
  </div>
)
