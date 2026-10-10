import { FC, ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface Props {
  /** A bar under the content, set off by a top border: a `SaveBar`, a note. */
  footer?: ReactNode
  /** The faint `bg-muted/40` panel instead of the page background. */
  muted?: boolean
  /** Hairline `divide-y` rules between the children (list rows). */
  divided?: boolean
  /**
   * One form's box: the children are `FormRow`s (and `FormGroup`s) spaced by
   * their padding, never divided, with `py-1.5` so the first and last rows sit
   * 16px from the edge. Wins over `divided`.
   */
  form?: boolean
  /**
   * Keep the footer in reach on a long form: it sticks to the bottom of the
   * viewport (respecting the safe area) until the box ends. The content gets a
   * scroll margin (`scroll-mb-24`) so a field focused with Tab scrolls clear of
   * the footer instead of landing under it.
   */
  stickyFooter?: boolean
  className?: string
  children: ReactNode
}

/**
 * The one flat surface: `rounded-lg border bg-background`, no shadow. Content
 * that belongs together (a settings form's rows, a list's rows, a chart) sits
 * in one Frame: `divided` draws the hairlines between a list's rows, `form`
 * spaces a form's rows with no lines and leaves the one rule above the footer.
 */
export const Frame: FC<Props> = ({
  footer,
  muted = false,
  divided = false,
  form = false,
  stickyFooter = false,
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
    {form ? (
      <div
        data-slot="frame-content"
        className={cn('py-1.5', stickyFooter && '[&_*]:scroll-mb-24')}
      >
        {children}
      </div>
    ) : divided ? (
      <div className={cn('divide-y', stickyFooter && '[&_*]:scroll-mb-24')}>
        {children}
      </div>
    ) : stickyFooter ? (
      <div className="[&_*]:scroll-mb-24">{children}</div>
    ) : (
      children
    )}
    {footer ? (
      <div
        data-slot="frame-footer"
        className={cn(
          'border-t px-4 py-3',
          stickyFooter &&
            'sticky bottom-0 z-10 rounded-b-lg bg-background pb-[max(0.75rem,env(safe-area-inset-bottom))]'
        )}
      >
        {footer}
      </div>
    ) : null}
  </div>
)
