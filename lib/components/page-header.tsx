'use client'

import { CSSProperties, ReactNode, createContext, useContext } from 'react'

import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}

// Break out of the timeline column (`max-w-2xl`) so the chrome spans the full
// area to the right of the fixed sidebar. The inner row stays centered at
// `max-w-2xl` so the title aligns above the post column.
//
// 50% here is half of the parent's content-box width (Tailwind's `px-4` is part
// of the box, not the content area). The horizontal pair therefore collapses to
// `(parent content width) + 2*M = 100vw - sidebar-w`, which is exactly the
// available area beside the fixed sidebar at any viewport size.
const breakoutStyle: CSSProperties = {
  marginLeft: 'calc(-50vw + 50% + var(--sidebar-w, 0px) / 2)',
  marginRight: 'calc(-50vw + 50% + var(--sidebar-w, 0px) / 2)'
}

const PageSubnavContext = createContext<ReactNode>(null)

/**
 * Hosts a section-level sub-navigation (admin tabs, etc.) that the closest
 * `PageHeader` will render inside its sticky chrome, directly below the title
 * row. Wrap the layout that owns the sub-nav so every child page automatically
 * gets the sub-nav pinned beneath the page header instead of scrolling above
 * it.
 */
export const PageSubnavProvider = ({
  subnav,
  children
}: {
  subnav: ReactNode
  children: ReactNode
}) => (
  <PageSubnavContext.Provider value={subnav}>
    {children}
  </PageSubnavContext.Provider>
)

const PageHeaderSectionContext = createContext<boolean>(false)

/**
 * Switches every descendant `PageHeader` into "section" mode: a plain,
 * non-sticky, non-breakout in-panel title block instead of the full-width
 * sticky chrome. Used by section layouts (settings, fitness) that render their
 * own vertical nav rail beside the content, so the per-page title sits at the
 * top of the content column rather than spanning the rail. Default (no
 * provider) keeps the original sticky header untouched for timeline and admin.
 */
export const PageHeaderSectionProvider = ({
  children
}: {
  children: ReactNode
}) => (
  <PageHeaderSectionContext.Provider value={true}>
    {children}
  </PageHeaderSectionContext.Provider>
)

export const PageHeader = ({
  title,
  description,
  actions,
  className
}: PageHeaderProps) => {
  const subnav = useContext(PageSubnavContext)
  const isSection = useContext(PageHeaderSectionContext)

  if (isSection) {
    return (
      <div className={cn('mb-6', className)}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </div>
            )}
          </div>
          {actions && <div className="shrink-0 self-center">{actions}</div>}
        </div>
        {subnav && <div className="mt-4">{subnav}</div>}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'sticky top-0 z-20 border-b bg-background/85 backdrop-blur',
        className
      )}
      style={breakoutStyle}
    >
      <div className="mx-auto max-w-2xl px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && (
              <div className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </div>
            )}
          </div>
          {actions && <div className="shrink-0 self-center">{actions}</div>}
        </div>
        {subnav && <div className="mt-3">{subnav}</div>}
      </div>
    </div>
  )
}
